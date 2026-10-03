import { and, desc, eq, gte, inArray, sum } from "drizzle-orm";
import type { Database } from "@/db";
import { discoverRuns, jobLeads, jobSearches, leadSearchMatches, profiles, jobs, type DiscoverMode, type LeadSource, type LeadStatus } from "@/db/schema";
import { createJob } from "@/lib/jobs/jobs";
import { dedupeKey } from "./dedupe";
import { SOURCES } from "./sources";
import { exploreEligibility } from "./eligibility";
import { scoreLead } from "./score";

export type JobLead = typeof jobLeads.$inferSelect;
export type LeadListItem = JobLead & { searchName: string | null; inPipeline: boolean; eligibility?: ReturnType<typeof exploreEligibility> };

export class LeadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeadError";
  }
}

export type LeadFilter = {
  mode?: DiscoverMode;
  excluded?: boolean;
  status?: LeadStatus | "all";
  source?: LeadSource;
  searchId?: string;
  minScore?: number;
  limit?: number;
};

async function pipelineKeys(db: Database, userId: string): Promise<Set<string>> {
  const rows = await db.select({ company: jobs.company, title: jobs.title }).from(jobs).where(eq(jobs.userId, userId));
  return new Set(rows.map((r) => dedupeKey(r.company, r.title)));
}

/** Best matches first, then newest. `inPipeline` marks leads that already exist as jobs. */
export async function listLeads(db: Database, userId: string, filter: LeadFilter = {}): Promise<LeadListItem[]> {
  const conditions = [eq(jobLeads.userId, userId)];
  const status = filter.status ?? "new";
  if (status !== "all") conditions.push(eq(jobLeads.status, status));
  if (filter.source) conditions.push(eq(jobLeads.source, filter.source));
  const [rows, keys, profileRows] = await Promise.all([
    db
      .select({ lead: jobLeads, match: leadSearchMatches, searchName: jobSearches.name, searchLocation: jobSearches.location, remoteOnly: jobSearches.remoteOnly })
      .from(jobLeads)
      .leftJoin(leadSearchMatches, and(eq(leadSearchMatches.leadId, jobLeads.id), eq(leadSearchMatches.userId, userId)))
      .leftJoin(jobSearches, and(eq(jobSearches.id, leadSearchMatches.searchId), eq(jobSearches.userId, userId)))
      .where(and(...conditions))
      .orderBy(desc(jobLeads.score), desc(jobLeads.postedAt), desc(jobLeads.firstSeenAt)),
    pipelineKeys(db, userId),
    db.select().from(profiles).where(eq(profiles.userId, userId)),
  ]);
  const profile = profileRows[0];
  const mode = filter.mode ?? "priority";
  const best = new Map<string, LeadListItem>();
  for (const { lead, match, searchName, searchLocation, remoteOnly } of rows) {
    if ((match?.mode ?? "priority") !== mode) continue;
    if (filter.searchId && (match?.searchId ?? lead.searchId) !== filter.searchId) continue;
    const ranked = mode === "explore" ? scoreLead(lead, {
      query: match?.query ?? lead.title, directionTerms: match?.directionTerms ?? [], mode,
      targetLocations: [...(profile?.targetLocations ?? []), ...(searchLocation ? [searchLocation] : [])],
      remoteOk: Boolean(remoteOnly || (profile?.remoteOk ?? true)), compMin: profile?.compMin ?? null, targetRoles: [],
    }) : { score: match?.score ?? lead.score, reasons: match?.scoreReasons ?? lead.scoreReasons };
    if (filter.minScore && ranked.score < filter.minScore) continue;
    const eligibility = mode === "explore" ? exploreEligibility(lead, profile?.compMin ?? null) : undefined;
    if (eligibility && eligibility.excluded !== Boolean(filter.excluded)) continue;
    const item = { ...lead, score: ranked.score, scoreReasons: ranked.reasons, searchName, eligibility, inPipeline: Boolean(lead.jobId) || keys.has(lead.dedupeKey) };
    const previous = best.get(lead.id);
    if (!previous || item.score > previous.score) best.set(lead.id, item);
  }
  return [...best.values()].sort((a, b) => b.score - a.score || (b.postedAt?.getTime() ?? 0) - (a.postedAt?.getTime() ?? 0) || b.firstSeenAt.getTime() - a.firstSeenAt.getTime()).slice(0, filter.limit ?? 200);
}

export async function getLead(db: Database, userId: string, leadId: string): Promise<JobLead | null> {
  const [row] = await db.select().from(jobLeads).where(and(eq(jobLeads.id, leadId), eq(jobLeads.userId, userId)));
  return row ?? null;
}

export async function leadCounts(db: Database, userId: string, filter: Omit<LeadFilter, "status" | "limit"> = {}): Promise<Record<LeadStatus, number>> {
  const rows = await listLeads(db, userId, { ...filter, status: "all", limit: Infinity });
  const counts: Record<LeadStatus, number> = { new: 0, saved: 0, dismissed: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

/** Dismiss or bring back a lead. Saved leads stay saved. */
export async function setLeadStatus(db: Database, userId: string, leadId: string, status: "new" | "dismissed"): Promise<void> {
  const lead = await getLead(db, userId, leadId);
  if (!lead) throw new LeadError("Posting not found.");
  if (lead.status === "saved") throw new LeadError("This posting is already in your pipeline.");
  await db.update(jobLeads).set({ status }).where(and(eq(jobLeads.id, leadId), eq(jobLeads.userId, userId)));
}

export async function dismissLeads(db: Database, userId: string, leadIds: string[]): Promise<void> {
  if (!leadIds.length) return;
  await db
    .update(jobLeads)
    .set({ status: "dismissed" })
    .where(and(eq(jobLeads.userId, userId), eq(jobLeads.status, "new"), inArray(jobLeads.id, leadIds)));
}

/** The posting text a saved lead starts with. Short when the source only gives a snippet. */
export function leadPostingText(lead: Pick<JobLead, "title" | "company" | "location" | "salaryText" | "description" | "url" | "publisher">): string {
  const header = [lead.title, [lead.company, lead.location].filter(Boolean).join(" — "), lead.salaryText].filter(Boolean).join("\n");
  const body = lead.description.trim() || "The source only gave a summary. Open the original posting and paste the full description here for a better analysis.";
  return `${header}\n\n${body}\n\nOriginal posting${lead.publisher ? ` (${lead.publisher})` : ""}: ${lead.url}`.slice(0, 60_000);
}

/**
 * Turns a lead into a job (and its "saved" application). Analysis is left to
 * the caller, like the Add a job form. Saving twice returns the same job.
 */
export async function saveLeadToPipeline(db: Database, userId: string, leadId: string): Promise<string> {
  const lead = await getLead(db, userId, leadId);
  if (!lead) throw new LeadError("Posting not found.");
  if (lead.jobId) return lead.jobId;
  const job = await createJob(db, userId, {
    postingText: leadPostingText(lead),
    sourceUrl: /^https?:\/\//i.test(lead.url) ? lead.url : "",
    company: lead.company,
    title: lead.title,
    location: lead.isRemote && !lead.location ? "Remote" : lead.location,
    compText: lead.salaryText,
  });
  await db.update(jobLeads).set({ status: "saved", jobId: job.id }).where(and(eq(jobLeads.id, leadId), eq(jobLeads.userId, userId)));
  return job.id;
}

export type SourceStatus = {
  id: LeadSource;
  label: string;
  description: string;
  attribution: { text: string; href: string } | null;
  envVars: string[];
  configured: boolean;
  usedThisMonth: number;
  usedToday: number;
  monthlyQuota: number | null;
  dailyQuota: number | null;
  lastRun: { status: "ok" | "error" | "skipped"; at: Date; message: string | null; found: number; added: number } | null;
};

/** Per source: is it set up, how much of the free quota is used, and how the last fetch went. */
export async function sourceStatuses(db: Database, userId: string, now = new Date()): Promise<SourceStatus[]> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [month, day, recent] = await Promise.all([
    db.select({ source: discoverRuns.source, n: sum(discoverRuns.requests) }).from(discoverRuns).where(and(eq(discoverRuns.userId, userId), gte(discoverRuns.createdAt, monthStart))).groupBy(discoverRuns.source),
    db.select({ source: discoverRuns.source, n: sum(discoverRuns.requests) }).from(discoverRuns).where(and(eq(discoverRuns.userId, userId), gte(discoverRuns.createdAt, dayStart))).groupBy(discoverRuns.source),
    db.select().from(discoverRuns).where(eq(discoverRuns.userId, userId)).orderBy(desc(discoverRuns.createdAt)).limit(100),
  ]);
  const used = (rows: Array<{ source: LeadSource; n: string | null }>, id: LeadSource) => Number(rows.find((r) => r.source === id)?.n ?? 0);
  return SOURCES.map((source) => {
    const last = recent.find((run) => run.source === source.id && run.status !== "skipped") ?? recent.find((run) => run.source === source.id);
    return {
      id: source.id,
      label: source.label,
      description: source.description,
      attribution: source.attribution,
      envVars: source.envVars,
      configured: source.configured(),
      usedThisMonth: used(month, source.id),
      usedToday: used(day, source.id),
      monthlyQuota: source.policy.monthlyQuota ?? null,
      dailyQuota: source.policy.dailyQuota ?? null,
      lastRun: last ? { status: last.status, at: last.createdAt, message: last.message, found: last.found, added: last.added } : null,
    };
  });
}
