import { and, asc, eq, gte, inArray, lt, lte, sum } from "drizzle-orm";
import type { Database } from "@/db";
import { discoverRuns, jobLeads, jobSearches, leadSearchMatches, LEAD_SOURCES, profiles, type CareerPath, type DiscoverMode, type LeadSource, type ScoreReason } from "@/db/schema";
import { dedupeKey } from "./dedupe";
import { scoreLead, type ScoreContext } from "./score";
import { getSource, SOURCES } from "./sources";
import { env, redact, SourceError } from "./sources/shared";
import type { FetchLike, NormalizedLead, RefreshSummary, SearchSpec, SourceAdapter, SourceRunResult } from "./types";

/*
 * Refresh: every active saved search × each of its sources. A source is
 * skipped when it isn't set up, when it only lists remote jobs and neither
 * the search nor the profile is open to remote, when it ran for the same
 * search within its interval (unless forced), or when its request quota
 * would be exceeded (never bypassed). One source failing never stops the
 * rest. Every attempt, skipped or not, is logged in discover_runs.
 *
 * Leads upsert by (user, source, external id): existing ones get fresh
 * details, score and last-seen time but keep their status and job link.
 * Within one run only one lead per company|title is added across sources —
 * the one with the fullest description — and none is added when another
 * source's existing lead for the same job was seen in the same run.
 */

export type RefreshOptions = { searchId?: string; mode?: DiscoverMode; force?: boolean; now?: Date; fetchImpl?: FetchLike };

type Search = typeof jobSearches.$inferSelect;

type Profile = { targetLocations: string[]; remoteOk: boolean; compMin: number | null; targetRoles: CareerPath[] };

const DEFAULT_PROFILE: Profile = {
  targetLocations: [],
  remoteOk: true,
  compMin: null,
  targetRoles: ["customer_success", "implementation", "account_management", "employer_wellbeing"],
};

type RunState = { result: SourceRunResult; runId: string | null; searchIndex: number; sourceIndex: number };

type Candidate = {
  lead: NormalizedLead;
  key: string;
  score: number;
  reasons: ScoreReason[];
  searchId: string;
  run: RunState;
};

const MINUTE_MS = 60_000;
const INSERT_CHUNK = 100;

const sourceOrder = (id: LeadSource) => {
  const index = SOURCES.findIndex((s) => s.id === id);
  return index === -1 ? SOURCES.length + LEAD_SOURCES.indexOf(id) : index;
};

const idKey = (source: LeadSource, externalId: string) => `${source}|${externalId}`;

function monthBounds(now: Date) {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

function dayBounds(now: Date) {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)),
  };
}

function duration(minutes: number): string {
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`;
  const hours = Math.round(minutes / 6) / 10;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
}

/** Secrets never reach the database or the UI, even inside an error message. */
function errorMessage(error: unknown, keyless = false): string {
  const secrets = SOURCES.flatMap((s) => s.envVars).map(env);
  const message = error instanceof Error ? error.message : "Unknown error.";
  const text = redact(message, secrets);
  // A source without an API key has no key to check; a refusal means the site is blocking us.
  return (keyless ? text.replace(/ \(check the API key(?: or plan)?\)/, " (the site refused the request)") : text).slice(0, 300);
}

async function loadProfile(db: Database, userId: string): Promise<Profile> {
  const [row] = await db
    .select({ targetLocations: profiles.targetLocations, remoteOk: profiles.remoteOk, compMin: profiles.compMin, targetRoles: profiles.targetRoles })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  return row ?? DEFAULT_PROFILE;
}

/**
 * Requests already spent this UTC month and day, per source. Counted across
 * every user because the API keys (and their free-tier quotas) are shared.
 */
async function loadUsage(db: Database, now: Date) {
  const month = monthBounds(now);
  const day = dayBounds(now);
  const [monthRows, dayRows] = await Promise.all([
    db.select({ source: discoverRuns.source, n: sum(discoverRuns.requests) }).from(discoverRuns).where(and(gte(discoverRuns.createdAt, month.start), lt(discoverRuns.createdAt, month.end))).groupBy(discoverRuns.source),
    db.select({ source: discoverRuns.source, n: sum(discoverRuns.requests) }).from(discoverRuns).where(and(gte(discoverRuns.createdAt, day.start), lt(discoverRuns.createdAt, day.end))).groupBy(discoverRuns.source),
  ]);
  const usage = new Map<LeadSource, { month: number; day: number }>();
  for (const id of LEAD_SOURCES) {
    usage.set(id, {
      month: Number(monthRows.find((r) => r.source === id)?.n ?? 0),
      day: Number(dayRows.find((r) => r.source === id)?.n ?? 0),
    });
  }
  return usage;
}

/** Why a source can't spend another request now, or null when it can. */
function quotaBlock(adapter: SourceAdapter, used: { month: number; day: number }): string | null {
  const { monthlyQuota, dailyQuota } = adapter.policy;
  if (monthlyQuota != null && used.month + 1 > monthlyQuota) return `Monthly quota used (${used.month} of ${monthlyQuota} requests); resumes next month.`;
  if (dailyQuota != null && used.day + 1 > dailyQuota) return `Daily quota used (${used.day} of ${dailyQuota} requests); resumes tomorrow (UTC).`;
  return null;
}

function searchSpec(search: Search): SearchSpec {
  return { query: search.query, location: search.location, remoteOnly: search.remoteOnly, maxAgeDays: search.maxAgeDays };
}

function scoreContext(search: Search, profile: Profile): ScoreContext {
  const place = search.location.trim();
  const targetLocations = place && !/^(remote|anywhere)$/i.test(place) ? [...profile.targetLocations, place] : profile.targetLocations;
  return { query: search.query, targetLocations, remoteOk: profile.remoteOk || search.remoteOnly, compMin: profile.compMin, targetRoles: profile.targetRoles, mode: search.mode, directionTerms: search.directionTerms };
}

/** Longer description wins; ties go to the source listed first. */
function better(a: Candidate, b: Candidate): boolean {
  if (a.lead.description.length !== b.lead.description.length) return a.lead.description.length > b.lead.description.length;
  return sourceOrder(a.lead.source) < sourceOrder(b.lead.source);
}

export async function refreshSearches(db: Database, userId: string, options: RefreshOptions = {}): Promise<RefreshSummary> {
  const now = options.now ?? new Date();
  const searches = await db
    .select()
    .from(jobSearches)
    .where(and(eq(jobSearches.userId, userId), eq(jobSearches.mode, options.mode ?? "priority"), options.searchId ? eq(jobSearches.id, options.searchId) : eq(jobSearches.active, true)))
    .orderBy(asc(jobSearches.createdAt));
  if (!searches.length) return { runs: [], added: 0, found: 0 };

  const maxInterval = Math.max(...SOURCES.map((s) => s.policy.minIntervalMinutes));
  const [profile, usage, recentRuns] = await Promise.all([
    loadProfile(db, userId),
    loadUsage(db, now),
    db
      .select({ source: discoverRuns.source, searchId: discoverRuns.searchId, query: discoverRuns.query, createdAt: discoverRuns.createdAt })
      .from(discoverRuns)
      .where(
        and(
          eq(discoverRuns.userId, userId),
          eq(discoverRuns.status, "ok"),
          gte(discoverRuns.createdAt, new Date(now.getTime() - maxInterval * MINUTE_MS)),
          lte(discoverRuns.createdAt, now),
        ),
      ),
  ]);

  const runs: RunState[] = [];
  /** New postings by company|title, across sources, waiting to be inserted. */
  const candidates = new Map<string, Candidate[]>();
  /** company|title → sources whose already-stored lead was seen this run. */
  const claimed = new Map<string, Set<LeadSource>>();
  /** source|externalId handled this run (two searches can return the same posting). */
  const handled = new Set<string>();
  // Capture every match before deduplication (including a second search for one source id).
  const observed = new Map<string, Map<string, Search>>();
  const queryBySearch = new Map(searches.map((s) => [s.id, s.query]));

  async function record(state: Omit<RunState, "runId">): Promise<RunState> {
    const { result } = state;
    const [row] = await db
      .insert(discoverRuns)
      .values({
        userId,
        source: result.source,
        searchId: result.searchId,
        query: queryBySearch.get(result.searchId) ?? "",
        status: result.status,
        requests: result.requests,
        found: result.found,
        added: result.added,
        message: result.message,
        createdAt: now,
      })
      .returning({ id: discoverRuns.id });
    const run = { ...state, runId: row?.id ?? null };
    runs.push(run);
    return run;
  }

  function addCandidate(candidate: Candidate) {
    const list = candidates.get(candidate.key) ?? [];
    const rivals = list.filter((c) => c.lead.source !== candidate.lead.source);
    if (!rivals.length) {
      list.push(candidate);
      candidates.set(candidate.key, list);
      return;
    }
    if (rivals.every((rival) => better(candidate, rival))) {
      const kept = list.filter((c) => c.lead.source === candidate.lead.source);
      kept.push(candidate);
      candidates.set(candidate.key, kept);
    }
  }

  /** Scores the fetched postings, updates the ones already stored and queues the new ones. */
  async function absorb(search: Search, adapter: SourceAdapter, leads: NormalizedLead[]) {
    const context = scoreContext(search, profile);
    const fresh = new Map<string, NormalizedLead>();
    for (const lead of leads) {
      if (!lead.externalId || fresh.has(lead.externalId)) continue;
      fresh.set(lead.externalId, lead);
    }
    const ids = [...fresh.keys()];
    const existing = ids.length
      ? await db
          .select({ id: jobLeads.id, externalId: jobLeads.externalId, searchId: jobLeads.searchId })
          .from(jobLeads)
          .where(and(eq(jobLeads.userId, userId), eq(jobLeads.source, adapter.id), inArray(jobLeads.externalId, ids)))
      : [];
    const byExternalId = new Map(existing.map((row) => [row.externalId, row]));

    const queued: Array<Omit<Candidate, "run">> = [];
    const seenKeys: string[] = [];
    for (const lead of fresh.values()) {
      const observedKey = dedupeKey(lead.company, lead.title);
      const matches = observed.get(observedKey) ?? new Map<string, Search>();
      matches.set(search.id, search);
      observed.set(observedKey, matches);
      const handle = idKey(adapter.id, lead.externalId);
      if (handled.has(handle)) continue;
      handled.add(handle);
      const key = dedupeKey(lead.company, lead.title);
      const { score, reasons } = scoreLead(lead, context, now);
      const row = byExternalId.get(lead.externalId);
      if (!row) {
        queued.push({ lead, key, score, reasons, searchId: search.id });
        continue;
      }
      seenKeys.push(key);
      await db
        .update(jobLeads)
        .set({
          searchId: row.searchId ?? search.id,
          dedupeKey: key,
          title: lead.title,
          company: lead.company,
          location: lead.location,
          isRemote: lead.isRemote,
          salaryMin: lead.salaryMin,
          salaryMax: lead.salaryMax,
          salaryText: lead.salaryText,
          salaryProvenance: lead.salaryProvenance ?? "unknown",
          publisher: lead.publisher,
          url: lead.url,
          applyOptions: lead.applyOptions,
          description: lead.description,
          postedAt: lead.postedAt,
          ...(search.mode === "priority" ? { score, scoreReasons: reasons } : {}),
          lastSeenAt: now,
        })
        .where(and(eq(jobLeads.id, row.id), eq(jobLeads.userId, userId)));
    }
    return { found: fresh.size, queued, seenKeys };
  }

  async function runSource(search: Search, searchIndex: number, sourceId: LeadSource): Promise<void> {
    const adapter = getSource(sourceId);
    const sourceIndex = sourceOrder(sourceId);
    const base = { source: sourceId, searchId: search.id, found: 0, added: 0, requests: 0 };
    const skip = (message: string) => record({ result: { ...base, status: "skipped", message }, searchIndex, sourceIndex });

    if (!adapter) return void (await skip("Unknown source."));
    if (!adapter.configured()) return void (await skip(`Not set up: add ${adapter.envVars.join(" and ")} to the environment.`));
    if (adapter.remoteOnly && !search.remoteOnly && !profile.remoteOk) {
      return void (await skip("Remote-only board, and neither this search nor your profile is open to remote work."));
    }
    if (!options.force) {
      const interval = adapter.policy.minIntervalMinutes;
      const last = recentRuns
        .filter((r) => r.source === sourceId && r.searchId === search.id && r.query === search.query && now.getTime() - r.createdAt.getTime() < interval * MINUTE_MS)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      if (last) {
        const since = (now.getTime() - last.createdAt.getTime()) / MINUTE_MS;
        return void (await skip(`Checked ${duration(since)} ago; this source waits ${duration(interval)} between checks.`));
      }
    }
    const used = usage.get(sourceId) ?? { month: 0, day: 0 };
    const blocked = quotaBlock(adapter, used);
    if (blocked) return void (await skip(blocked));

    let requests = 0;
    const spend = (n: number) => {
      requests = n;
      used.month += n;
      used.day += n;
    };
    try {
      const fetched = await adapter.fetch(searchSpec(search), options.fetchImpl);
      spend(fetched.requests);
      const leads = search.remoteOnly ? fetched.leads.filter((lead) => lead.isRemote) : fetched.leads;
      const absorbed = await absorb(search, adapter, leads);
      const run = await record({
        result: { ...base, status: "ok", found: absorbed.found, requests, message: `${absorbed.found} found` },
        searchIndex,
        sourceIndex,
      });
      for (const key of absorbed.seenKeys) {
        const sources = claimed.get(key) ?? new Set<LeadSource>();
        sources.add(sourceId);
        claimed.set(key, sources);
      }
      for (const candidate of absorbed.queued) addCandidate({ ...candidate, run });
    } catch (error) {
      if (!requests) spend(error instanceof SourceError ? error.requests : 1);
      await record({ result: { ...base, status: "error", requests, message: errorMessage(error, !SOURCES.find((source) => source.id === sourceId)?.envVars.length) }, searchIndex, sourceIndex });
    }
  }

  // Sources run side by side; each walks the searches in order so its quota count stays exact.
  const sourceIds = LEAD_SOURCES.filter((id) => searches.some((s) => s.sources.includes(id)));
  const settled = await Promise.allSettled(
    sourceIds.map(async (sourceId) => {
      for (const [index, search] of searches.entries()) {
        if (search.sources.includes(sourceId)) await runSource(search, index, sourceId);
      }
    }),
  );
  const failure = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
  if (failure) throw failure.reason;

  // One new lead per job across sources, unless another source's stored lead for it was seen.
  const observedKeys = [...observed.keys()];
  const stored = observedKeys.length ? await db.select().from(jobLeads)
    .where(and(eq(jobLeads.userId, userId), inArray(jobLeads.dedupeKey, observedKeys)))
    .orderBy(asc(jobLeads.firstSeenAt), asc(jobLeads.id)) : [];
  const storedKeys = new Set(stored.map((lead) => lead.dedupeKey));
  const winners: Candidate[] = [];
  for (const [key, list] of candidates) {
    if (storedKeys.has(key)) continue;
    const owners = claimed.get(key);
    for (const candidate of list) {
      if (owners && [...owners].some((source) => source !== candidate.lead.source)) continue;
      winners.push(candidate);
    }
  }

  const addedByRun = new Map<RunState, number>();
  const runByHandle = new Map(winners.map((c) => [idKey(c.lead.source, c.lead.externalId), c.run]));
  for (let i = 0; i < winners.length; i += INSERT_CHUNK) {
    const chunk = winners.slice(i, i + INSERT_CHUNK);
    const inserted = await db
      .insert(jobLeads)
      .values(
        chunk.map(({ lead, key, score, reasons, searchId }) => ({
          userId,
          source: lead.source,
          externalId: lead.externalId,
          searchId,
          dedupeKey: key,
          title: lead.title,
          company: lead.company,
          location: lead.location,
          isRemote: lead.isRemote,
          salaryMin: lead.salaryMin,
          salaryMax: lead.salaryMax,
          salaryText: lead.salaryText,
          salaryProvenance: lead.salaryProvenance ?? "unknown",
          publisher: lead.publisher,
          url: lead.url,
          applyOptions: lead.applyOptions,
          description: lead.description,
          postedAt: lead.postedAt,
          score,
          scoreReasons: reasons,
          status: "new" as const,
          firstSeenAt: now,
          lastSeenAt: now,
        })),
      )
      .onConflictDoNothing()
      .returning({ source: jobLeads.source, externalId: jobLeads.externalId });
    for (const row of inserted) {
      const run = runByHandle.get(idKey(row.source, row.externalId));
      if (run) addedByRun.set(run, (addedByRun.get(run) ?? 0) + 1);
    }
  }

  const allLeads = observedKeys.length ? await db.select().from(jobLeads)
    .where(and(eq(jobLeads.userId, userId), inArray(jobLeads.dedupeKey, observedKeys)))
    .orderBy(asc(jobLeads.firstSeenAt), asc(jobLeads.id)) : [];
  const canonical = new Map<string, typeof jobLeads.$inferSelect>();
  for (const lead of allLeads) if (!canonical.has(lead.dedupeKey)) canonical.set(lead.dedupeKey, lead);
  for (const [key, matches] of observed) {
    const lead = canonical.get(key);
    if (!lead) continue;
    // Supports old/unassigned leads added after the migration as well.
    if (stored.some((row) => row.id === lead.id)) {
      const [membership] = await db.select({ id: leadSearchMatches.id }).from(leadSearchMatches)
        .where(and(eq(leadSearchMatches.userId, userId), eq(leadSearchMatches.leadId, lead.id))).limit(1);
      if (!membership) await db.insert(leadSearchMatches).values({ userId, leadId: lead.id, searchKey: "legacy", mode: "priority", query: lead.title, score: lead.score, scoreReasons: lead.scoreReasons }).onConflictDoNothing();
    }
    for (const search of matches.values()) {
      const ranked = scoreLead(lead, scoreContext(search, profile), now);
      const values = { searchId: search.id, mode: search.mode, query: search.query, directionTerms: search.directionTerms, score: ranked.score, scoreReasons: ranked.reasons };
      await db.insert(leadSearchMatches).values({ userId, leadId: lead.id, searchKey: search.id, ...values })
        .onConflictDoUpdate({ target: [leadSearchMatches.userId, leadSearchMatches.leadId, leadSearchMatches.searchKey], set: values });
    }
  }

  for (const [run, added] of addedByRun) {
    run.result.added = added;
    run.result.message = `${run.result.found} found, ${added} new`;
    if (run.runId) await db.update(discoverRuns).set({ added, message: run.result.message }).where(eq(discoverRuns.id, run.runId));
  }

  const ran = [...new Set(runs.filter((r) => r.result.status !== "skipped").map((r) => r.result.searchId))];
  if (ran.length) await db.update(jobSearches).set({ lastRunAt: now }).where(and(eq(jobSearches.userId, userId), inArray(jobSearches.id, ran)));

  const results = runs.sort((a, b) => a.searchIndex - b.searchIndex || a.sourceIndex - b.sourceIndex).map((r) => r.result);
  return {
    runs: results,
    added: results.reduce((total, r) => total + r.added, 0),
    found: results.reduce((total, r) => total + r.found, 0),
  };
}

export type RefreshAllSummary = RefreshSummary & { users: number; failedUsers: number };

/** The daily cron: every user with an active search, one after another (quotas are shared). */
export async function refreshAllUsers(db: Database, options: Omit<RefreshOptions, "searchId" | "mode"> = {}): Promise<RefreshAllSummary> {
  const users = await db.selectDistinct({ userId: jobSearches.userId }).from(jobSearches).where(and(eq(jobSearches.active, true), eq(jobSearches.mode, "priority")));
  const summary: RefreshAllSummary = { runs: [], added: 0, found: 0, users: users.length, failedUsers: 0 };
  for (const { userId } of users) {
    try {
      const result = await refreshSearches(db, userId, { ...options, mode: "priority" });
      summary.runs.push(...result.runs);
      summary.added += result.added;
      summary.found += result.found;
    } catch (error) {
      summary.failedUsers += 1;
      console.error("Discover refresh failed for one user:", errorMessage(error));
    }
  }
  return summary;
}
