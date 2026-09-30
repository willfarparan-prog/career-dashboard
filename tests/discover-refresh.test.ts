import assert from "node:assert/strict";
import { after, afterEach, before, mock, test } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { discoverRuns, jobLeads, jobSearches, profiles, type LeadSource } from "@/db/schema";
import { saveLeadToPipeline } from "@/lib/discover/leads";
import { GET } from "@/app/api/cron/discover/route";
import { refreshAllUsers, refreshSearches } from "@/lib/discover/refresh";
import { createSearch } from "@/lib/discover/searches";
import type { FetchLike } from "@/lib/discover/types";
import { testDatabase } from "./helpers";

/*
 * Refresh against PGlite with a fake fetch (no network). Postings are dated
 * relative to the real clock so the adapters' freshness filter keeps them;
 * `now` is passed explicitly wherever throttling or quotas are being tested.
 */

let db: Database;
let close: () => Promise<void>;
const ENV_KEYS = ["JSEARCH_API_KEY", "JSEARCH_PROVIDER", "ADZUNA_APP_ID", "ADZUNA_APP_KEY", "CRON_SECRET"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
}

before(async () => ({ db, close } = await testDatabase()));
afterEach(async () => {
  setEnv({});
  for (const table of ["job_leads", "discover_runs", "job_searches", "applications", "jobs", "profiles"]) {
    await db.execute(sql.raw(`delete from ${table}`));
  }
});
after(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await close();
});

const HOUR = 3_600_000;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

type Posting = { id: string; title: string; company: string; description?: string; remote?: boolean; location?: string };

const bodies: Record<LeadSource, (items: Posting[]) => string> = {
  jsearch: (items) =>
    JSON.stringify({
      status: "OK",
      data: items.map((p) => ({
        job_id: p.id,
        job_title: p.title,
        employer_name: p.company,
        job_publisher: "LinkedIn",
        job_apply_link: `https://www.linkedin.com/jobs/view/${p.id}`,
        job_description: p.description ?? "Short.",
        job_is_remote: p.remote ?? false,
        job_location: p.location ?? "Tampa, FL",
        job_posted_at_datetime_utc: daysAgo(1).toISOString(),
        job_min_salary: 85000,
        job_max_salary: 95000,
        job_salary_period: "YEAR",
      })),
    }),
  adzuna: (items) =>
    JSON.stringify({
      results: items.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description ?? "Snippet.",
        created: daysAgo(1).toISOString(),
        redirect_url: `https://www.adzuna.com/details/${p.id}`,
        company: { display_name: p.company },
        location: { display_name: p.location ?? "Tampa, Hillsborough County" },
      })),
    }),
  himalayas: (items) =>
    JSON.stringify({
      jobs: items.map((p) => ({
        title: p.title,
        companyName: p.company,
        description: `<p>${p.description ?? "Remote role."}</p>`,
        pubDate: Math.floor(daysAgo(1).getTime() / 1000),
        applicationLink: `https://himalayas.app/jobs/${p.id}`,
        guid: p.id,
      })),
    }),
  remotive: (items) =>
    JSON.stringify({
      jobs: items.map((p) => ({
        id: p.id,
        url: `https://remotive.com/remote-jobs/${p.id}`,
        title: p.title,
        company_name: p.company,
        publication_date: daysAgo(1).toISOString(),
        candidate_required_location: "USA Only",
        description: `<p>${p.description ?? "Remote role."}</p>`,
      })),
    }),
  wwr: (items) =>
    `<?xml version="1.0"?><rss version="2.0"><channel>${items
      .map(
        (p) =>
          `<item><title>${p.company}: ${p.title}</title><region>USA Only</region><link>https://weworkremotely.com/remote-jobs/${p.id}</link><guid>${p.id}</guid><pubDate>${daysAgo(1).toUTCString()}</pubDate><description><![CDATA[<p>${p.description ?? "Remote role."}</p>]]></description></item>`,
      )
      .join("")}</channel></rss>`,
};

function sourceOf(url: string): LeadSource {
  if (url.includes("jsearch")) return "jsearch";
  if (url.includes("adzuna")) return "adzuna";
  if (url.includes("himalayas")) return "himalayas";
  if (url.includes("remotive")) return "remotive";
  if (url.includes("weworkremotely")) return "wwr";
  throw new Error(`unexpected URL ${url}`);
}

type Route = Posting[] | number | Error;

/** Answers each source from `routes` (postings, an HTTP status, or a thrown error) and counts calls. */
function fakeSources(routes: Partial<Record<LeadSource, Route>>) {
  const calls: Record<LeadSource, number> = { jsearch: 0, adzuna: 0, himalayas: 0, remotive: 0, wwr: 0 };
  const fetchImpl: FetchLike = async (url) => {
    const source = sourceOf(url);
    calls[source] += 1;
    const route = routes[source] ?? [];
    if (route instanceof Error) throw route;
    if (typeof route === "number") return new Response("{}", { status: route });
    return new Response(bodies[source](route), { status: 200 });
  };
  return { fetchImpl, calls };
}

async function addProfile(userId: string, values: Partial<typeof profiles.$inferInsert> = {}) {
  await db.insert(profiles).values({ userId, targetLocations: ["Tampa, FL"], remoteOk: true, compMin: 80000, ...values });
}

const leadsOf = (userId: string) => db.select().from(jobLeads).where(eq(jobLeads.userId, userId));
const runsOf = (userId: string) => db.select().from(discoverRuns).where(eq(discoverRuns.userId, userId));

const CSM: Posting = { id: "p1", title: "Customer Success Manager", company: "Acme Health", description: "Own onboarding for employer clients." };

test("adds new leads with scores, records the run and the search's last run", async () => {
  setEnv({ JSEARCH_API_KEY: "test-jsearch-key" });
  await addProfile("u-add");
  const search = await createSearch(db, "u-add", { query: "customer success manager", location: "Tampa, FL", sources: ["jsearch"] });
  const now = new Date();
  const { fetchImpl, calls } = fakeSources({ jsearch: [CSM, { id: "p2", title: "Implementation Specialist", company: "Brightline" }] });

  const summary = await refreshSearches(db, "u-add", { now, fetchImpl });
  assert.equal(calls.jsearch, 1);
  assert.deepEqual(summary.runs.map((r) => [r.source, r.status, r.found, r.added, r.requests, r.message]), [["jsearch", "ok", 2, 2, 1, "2 found, 2 new"]]);
  assert.equal(summary.added, 2);
  assert.equal(summary.found, 2);

  const leads = await leadsOf("u-add");
  assert.equal(leads.length, 2);
  const csm = leads.find((l) => l.externalId === "p1");
  assert.ok(csm);
  assert.equal(csm.status, "new");
  assert.equal(csm.searchId, search.id);
  assert.equal(csm.dedupeKey, "acme health|customer success manager");
  assert.equal(csm.salaryText, "$85k–$95k a year");
  assert.ok(csm.score > 50);
  assert.equal(csm.scoreReasons.reduce((sum, r) => sum + r.points, 0), csm.score);
  assert.equal(csm.firstSeenAt.getTime(), now.getTime());

  const [run] = await runsOf("u-add");
  assert.equal(run.status, "ok");
  assert.equal(run.query, "customer success manager");
  assert.equal(run.requests, 1);
  assert.equal(run.added, 2);
  const [stored] = await db.select().from(jobSearches).where(eq(jobSearches.id, search.id));
  assert.equal(stored.lastRunAt?.getTime(), now.getTime());
});

test("sources that aren't set up are skipped without a request", async () => {
  await addProfile("u-skip");
  await createSearch(db, "u-skip", { query: "customer success manager" });
  const { fetchImpl, calls } = fakeSources({ himalayas: [CSM] });

  const summary = await refreshSearches(db, "u-skip", { fetchImpl });
  const byId = Object.fromEntries(summary.runs.map((r) => [r.source, r]));
  assert.deepEqual(summary.runs.map((r) => r.source), ["jsearch", "adzuna", "himalayas", "remotive", "wwr"]);
  assert.equal(byId.jsearch.status, "skipped");
  assert.match(byId.jsearch.message, /JSEARCH_API_KEY/);
  assert.equal(byId.adzuna.status, "skipped");
  assert.match(byId.adzuna.message, /ADZUNA_APP_ID and ADZUNA_APP_KEY/);
  assert.equal(byId.jsearch.requests + byId.adzuna.requests, 0);
  assert.equal(calls.jsearch + calls.adzuna, 0);
  assert.equal(byId.himalayas.status, "ok");
  assert.equal(byId.himalayas.added, 1);
  assert.equal((await runsOf("u-skip")).length, 5, "every source × search is recorded, skipped ones too");
});

test("remote-only boards skip when neither search nor profile is open to remote; remote-only searches drop on-site jobs", async () => {
  setEnv({ JSEARCH_API_KEY: "test-jsearch-key" });
  await addProfile("u-remote", { remoteOk: false });
  const local = await createSearch(db, "u-remote", { query: "customer success manager", location: "Tampa, FL", sources: ["jsearch", "himalayas"] });
  const { fetchImpl, calls } = fakeSources({
    jsearch: [CSM, { id: "p9", title: "Customer Success Manager", company: "Remoteco", remote: true, location: "Anywhere" }],
    himalayas: [{ id: "h1", title: "Customer Success Manager", company: "Lumen" }],
  });

  const first = await refreshSearches(db, "u-remote", { fetchImpl, searchId: local.id });
  const himalayasRun = first.runs.find((r) => r.source === "himalayas");
  assert.equal(himalayasRun?.status, "skipped");
  assert.match(himalayasRun?.message ?? "", /Remote-only board/);
  assert.equal(calls.himalayas, 0);
  assert.equal(first.runs.find((r) => r.source === "jsearch")?.added, 2);

  const remote = await createSearch(db, "u-remote", { query: "customer success manager", remoteOnly: true, sources: ["jsearch", "himalayas"] });
  const second = await refreshSearches(db, "u-remote", { fetchImpl, searchId: remote.id, force: true });
  assert.equal(second.runs.find((r) => r.source === "himalayas")?.status, "ok");
  assert.equal(second.runs.find((r) => r.source === "jsearch")?.found, 1, "the on-site Tampa job is dropped from a remote-only search");
});

test("the interval throttles repeat runs unless forced; a changed query runs again", async () => {
  setEnv({ JSEARCH_API_KEY: "test-jsearch-key" });
  await addProfile("u-throttle");
  const search = await createSearch(db, "u-throttle", { query: "customer success manager", sources: ["jsearch"] });
  const { fetchImpl, calls } = fakeSources({ jsearch: [CSM] });
  const t0 = new Date();

  await refreshSearches(db, "u-throttle", { now: t0, fetchImpl });
  const throttled = await refreshSearches(db, "u-throttle", { now: new Date(t0.getTime() + HOUR), fetchImpl });
  assert.equal(throttled.runs[0].status, "skipped");
  assert.match(throttled.runs[0].message, /Checked 1 h ago; this source waits 6 h/);
  assert.equal(calls.jsearch, 1);

  const forced = await refreshSearches(db, "u-throttle", { now: new Date(t0.getTime() + HOUR), fetchImpl, force: true });
  assert.equal(forced.runs[0].status, "ok");
  assert.equal(calls.jsearch, 2);

  const later = await refreshSearches(db, "u-throttle", { now: new Date(t0.getTime() + 8 * HOUR), fetchImpl });
  assert.equal(later.runs[0].status, "ok", "the interval has passed");
  assert.equal(calls.jsearch, 3);

  await db.update(jobSearches).set({ query: "client success manager" }).where(eq(jobSearches.id, search.id));
  const edited = await refreshSearches(db, "u-throttle", { now: new Date(t0.getTime() + 9 * HOUR), fetchImpl });
  assert.equal(edited.runs[0].status, "ok", "a new query isn't throttled by the old one");
});

test("quotas are never exceeded, even with force, and count every user's requests", async () => {
  setEnv({ JSEARCH_API_KEY: "test-jsearch-key" });
  await addProfile("u-quota");
  await createSearch(db, "u-quota", { query: "customer success manager", sources: ["jsearch", "remotive"] });
  const now = new Date();
  // Another user already spent 199 of JSearch's 200 monthly and all 4 of Remotive's daily requests.
  await db.insert(discoverRuns).values([
    { userId: "someone-else", source: "jsearch", status: "ok", requests: 199, createdAt: now },
    { userId: "someone-else", source: "remotive", status: "ok", requests: 4, createdAt: now },
    { userId: "someone-else", source: "jsearch", status: "ok", requests: 500, createdAt: new Date(now.getTime() - 40 * 86_400_000) },
  ]);
  const { fetchImpl, calls } = fakeSources({ jsearch: [CSM], remotive: [CSM] });

  const first = await refreshSearches(db, "u-quota", { now, fetchImpl, force: true });
  assert.equal(first.runs.find((r) => r.source === "jsearch")?.status, "ok", "the 200th request is allowed");
  const remotive = first.runs.find((r) => r.source === "remotive");
  assert.equal(remotive?.status, "skipped");
  assert.match(remotive?.message ?? "", /Daily quota used \(4 of 4 requests\)/);

  const second = await refreshSearches(db, "u-quota", { now: new Date(now.getTime() + 1000), fetchImpl, force: true });
  const jsearchRun = second.runs.find((r) => r.source === "jsearch");
  assert.equal(jsearchRun?.status, "skipped");
  assert.match(jsearchRun?.message ?? "", /Monthly quota used \(200 of 200 requests\)/);
  assert.equal(calls.jsearch, 1);
  assert.equal(calls.remotive, 0);
});

test("existing leads update in place but keep their status and job link", async () => {
  setEnv({ JSEARCH_API_KEY: "test-jsearch-key" });
  await addProfile("u-upsert");
  await createSearch(db, "u-upsert", { query: "customer success manager", sources: ["jsearch"] });
  const t0 = new Date();
  const other: Posting = { id: "p2", title: "Customer Success Lead", company: "Brightline" };
  await refreshSearches(db, "u-upsert", { now: t0, fetchImpl: fakeSources({ jsearch: [CSM, other] }).fetchImpl });

  const before = await leadsOf("u-upsert");
  const dismissed = before.find((l) => l.externalId === "p1");
  const saved = before.find((l) => l.externalId === "p2");
  assert.ok(dismissed && saved);
  await db.update(jobLeads).set({ status: "dismissed" }).where(eq(jobLeads.id, dismissed.id));
  const jobId = await saveLeadToPipeline(db, "u-upsert", saved.id);

  const t1 = new Date(t0.getTime() + 2 * HOUR);
  const changed = { ...CSM, title: "Customer Success Manager II", description: "Updated description." };
  const summary = await refreshSearches(db, "u-upsert", { now: t1, force: true, fetchImpl: fakeSources({ jsearch: [changed, other] }).fetchImpl });
  assert.equal(summary.added, 0);
  assert.equal(summary.found, 2);

  const after = await leadsOf("u-upsert");
  assert.equal(after.length, 2);
  const updated = after.find((l) => l.id === dismissed.id);
  assert.equal(updated?.status, "dismissed");
  assert.equal(updated?.title, "Customer Success Manager II");
  assert.equal(updated?.description, "Updated description.");
  assert.equal(updated?.lastSeenAt.getTime(), t1.getTime());
  assert.equal(updated?.firstSeenAt.getTime(), t0.getTime());
  const stillSaved = after.find((l) => l.id === saved.id);
  assert.equal(stillSaved?.status, "saved");
  assert.equal(stillSaved?.jobId, jobId);
});

test("the same job from several sources in one run is added once, with the fullest description", async () => {
  setEnv({ JSEARCH_API_KEY: "test-jsearch-key", ADZUNA_APP_ID: "test-app-id", ADZUNA_APP_KEY: "test-app-key" });
  await addProfile("u-dedupe");
  await createSearch(db, "u-dedupe", { query: "customer success manager", sources: ["jsearch", "adzuna", "remotive"] });
  const long = "A full description of the role. ".repeat(20);
  const routes = {
    jsearch: [{ ...CSM, id: "j1", description: "Short." }, { id: "j2", title: "Onboarding Specialist", company: "Brightline" }],
    adzuna: [{ ...CSM, id: "a1", company: "Acme Health, Inc.", description: "A medium snippet about the role." }],
    remotive: [{ ...CSM, id: "r1", description: long }],
  };
  const t0 = new Date();
  const first = await refreshSearches(db, "u-dedupe", { now: t0, fetchImpl: fakeSources(routes).fetchImpl });

  const leads = await leadsOf("u-dedupe");
  const csm = leads.filter((l) => l.dedupeKey === "acme health|customer success manager");
  assert.equal(csm.length, 1);
  assert.equal(csm[0].source, "remotive");
  assert.equal(leads.length, 2);
  assert.deepEqual(first.runs.map((r) => [r.source, r.found, r.added]), [["jsearch", 2, 1], ["adzuna", 1, 0], ["remotive", 1, 1]]);

  // Next run: Remotive's stored lead is seen again, so the others still aren't added.
  await refreshSearches(db, "u-dedupe", { now: new Date(t0.getTime() + 13 * HOUR), fetchImpl: fakeSources(routes).fetchImpl });
  assert.equal((await leadsOf("u-dedupe")).length, 2);
});

test("one source failing doesn't stop the others, and errors never carry keys", async () => {
  setEnv({ JSEARCH_API_KEY: "test-jsearch-key", ADZUNA_APP_ID: "test-app-id", ADZUNA_APP_KEY: "test-app-key" });
  await addProfile("u-error");
  await createSearch(db, "u-error", { query: "customer success manager" });
  const { fetchImpl } = fakeSources({
    jsearch: 500,
    adzuna: new Error("connect ECONNREFUSED https://api.adzuna.com/?app_key=test-app-key"),
    himalayas: [CSM],
    remotive: 429,
    wwr: [{ id: "w1", title: "Customer Success Manager", company: "Initech" }],
  });

  const summary = await refreshSearches(db, "u-error", { fetchImpl });
  const byId = Object.fromEntries(summary.runs.map((r) => [r.source, r]));
  assert.equal(byId.jsearch.status, "error");
  assert.equal(byId.jsearch.message, "JSearch returned 500 (server error).");
  assert.equal(byId.jsearch.requests, 1);
  assert.equal(byId.adzuna.status, "error");
  assert.equal(byId.adzuna.message, "Adzuna couldn't be reached (network error).");
  assert.equal(byId.remotive.status, "error");
  assert.match(byId.remotive.message, /rate limited/);
  assert.equal(byId.himalayas.status, "ok");
  assert.equal(byId.wwr.status, "ok");
  assert.equal(summary.added, 2);
  const stored = await runsOf("u-error");
  assert.equal(stored.filter((r) => r.status === "error").length, 3);
  assert.ok(stored.every((r) => !String(r.message).includes("test-")));
});

test("a refusal from a source with no API key doesn't tell you to check a key; one with a key does", async () => {
  setEnv({ JSEARCH_API_KEY: "test-jsearch-key" });
  await addProfile("u-hint");
  await createSearch(db, "u-hint", { query: "customer success manager" });
  const { fetchImpl } = fakeSources({ jsearch: 403, himalayas: 403, remotive: 403, wwr: 403 });
  const summary = await refreshSearches(db, "u-hint", { fetchImpl });
  const byId = Object.fromEntries(summary.runs.map((r) => [r.source, r]));
  assert.equal(byId.jsearch.message, "JSearch returned 403 (check the API key or plan).");
  for (const id of ["himalayas", "remotive", "wwr"] as const) {
    assert.match(byId[id].message, /returned 403 \(the site refused the request\)\.$/, id);
    assert.doesNotMatch(byId[id].message, /API key/, id);
  }
});

test("refresh only touches the given user's searches, leads and runs", async () => {
  setEnv({ JSEARCH_API_KEY: "test-jsearch-key" });
  await addProfile("u-a");
  await addProfile("u-b");
  await createSearch(db, "u-a", { query: "customer success manager", sources: ["jsearch"] });
  const searchB = await createSearch(db, "u-b", { query: "customer success manager", sources: ["jsearch"] });
  const { fetchImpl, calls } = fakeSources({ jsearch: [CSM] });
  const now = new Date();

  await refreshSearches(db, "u-b", { now, fetchImpl });
  const summaryA = await refreshSearches(db, "u-a", { now, fetchImpl });
  assert.equal(summaryA.runs[0].status, "ok", "u-b's recent run doesn't throttle u-a");
  assert.equal(calls.jsearch, 2);
  assert.equal((await leadsOf("u-a")).length, 1);
  assert.equal((await leadsOf("u-b")).length, 1);
  assert.equal((await runsOf("u-a")).length, 1);

  const foreign = await refreshSearches(db, "u-a", { now, fetchImpl, force: true, searchId: searchB.id });
  assert.deepEqual(foreign, { runs: [], added: 0, found: 0 });
  assert.equal(calls.jsearch, 2);
  const [leadB] = await leadsOf("u-b");
  assert.equal(leadB.searchId, searchB.id);
});

test("refreshAllUsers covers every user with an active search", async () => {
  setEnv({ JSEARCH_API_KEY: "test-jsearch-key" });
  await createSearch(db, "u-cron-1", { query: "customer success manager", sources: ["jsearch"] });
  await createSearch(db, "u-cron-2", { query: "implementation specialist", sources: ["jsearch"] });
  const paused = await createSearch(db, "u-cron-3", { query: "account manager", sources: ["jsearch"] });
  await db.update(jobSearches).set({ active: false }).where(and(eq(jobSearches.id, paused.id)));
  const { fetchImpl, calls } = fakeSources({ jsearch: [CSM] });

  const summary = await refreshAllUsers(db, { fetchImpl });
  assert.equal(summary.users, 2);
  assert.equal(summary.failedUsers, 0);
  assert.equal(calls.jsearch, 2);
  assert.equal(summary.added, 2);
  assert.equal((await leadsOf("u-cron-3")).length, 0);
});

test("the cron route needs the bearer secret and answers without posting text", async () => {
  const call = (authorization?: string) => GET(new Request("http://localhost/api/cron/discover", { headers: authorization ? { authorization } : {} }));

  assert.equal((await call()).status, 401, "CRON_SECRET unset");
  assert.equal((await call("Bearer undefined")).status, 401, "CRON_SECRET unset");
  setEnv({ CRON_SECRET: "test-cron-secret", JSEARCH_API_KEY: "test-jsearch-key" });
  assert.equal((await call()).status, 401);
  assert.equal((await call("Bearer wrong")).status, 401);

  await createSearch(db, "u-route", { query: "customer success manager", sources: ["jsearch"] });
  const { fetchImpl } = fakeSources({ jsearch: [{ ...CSM, description: "Secret sauce description." }] });
  const fetchMock = mock.method(globalThis, "fetch", fetchImpl);
  try {
    const response = await call("Bearer test-cron-secret");
    assert.equal(response.status, 200);
    const text = await response.text();
    const body = JSON.parse(text);
    assert.equal(body.ok, true);
    assert.equal(body.users, 1);
    assert.equal(body.added, 1);
    assert.equal(body.runs[0].source, "jsearch");
    assert.doesNotMatch(text, /Secret sauce|Acme Health|Customer Success Manager|test-jsearch-key/);
  } finally {
    fetchMock.mock.restore();
  }
});
