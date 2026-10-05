import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/db";
import { achievements, aiRuns, applications, jobRequirements, profiles, roles, snapshots } from "@/db/schema";
import { applyMatches, fakeMatch, matchEvidence, PROMPT_VERSION as MATCH_VERSION, type MatchTarget } from "@/lib/ai/tasks/match";
import { analyzeJob, fakeAnalysis, mergeAnalysis, parseCompRange, PROMPT_VERSION as ANALYZE_VERSION } from "@/lib/ai/tasks/analyze";
import { jobAlerts, type AlertJob } from "@/lib/jobs/alerts";
import { computeFit, roundToTotal, type FitJob } from "@/lib/jobs/fit";
import {
  createJob,
  deleteJob,
  getJob,
  getJobDetail,
  HAS_SNAPSHOTS_MESSAGE,
  JobError,
  listJobs,
  listRequirements,
  overrideRequirementLabel,
  setPostingStatus,
  updateJobFit,
  validateNewJob,
} from "@/lib/jobs/jobs";
import { testDatabase } from "./helpers";

let db: Database;
let close: () => Promise<void>;
before(async () => ({ db, close } = await testDatabase()));
after(async () => close());

const POSTING = `Title: Implementation Manager
Company: Acme Health
Location: Denver, CO (Hybrid)
Salary: $85,000 - $100,000
Requisition ID: R-2044
Apply by 2026-12-01.

We help employers roll out wellbeing programs that employees actually use, and we need someone to lead onboarding.

Responsibilities
- Lead onboarding programs for new employer clients
- Build training materials and run workshops for client stakeholders

Required qualifications
- 3+ years leading client programs
- Excellent stakeholder communication

Preferred
- Experience with Salesforce

Screening questions
- Are you authorized to work in the US?`;

const rejectsWith = (pattern: RegExp) => (error: unknown) => error instanceof JobError && pattern.test(error.message);

/* ---------- Intake ---------- */

test("creating a job also creates a saved application", async () => {
  const user = "intake-user";
  const job = await createJob(db, user, { postingText: "  Some posting  ", company: "Acme", interest: 5, growth: null });
  assert.equal(job.postingText, "Some posting");
  assert.equal(job.company, "Acme");
  assert.equal(job.interest, 5);
  assert.equal(job.growth, 3);
  const apps = await db.select().from(applications).where(eq(applications.jobId, job.id));
  assert.equal(apps.length, 1);
  assert.equal(apps[0].status, "saved");
  assert.equal(apps[0].userId, user);
});

test("intake validation catches bad input", () => {
  assert.throws(() => validateNewJob({ postingText: "   " }), rejectsWith(/Paste the job description/));
  assert.throws(() => validateNewJob({ postingText: "x", deadline: "12/01/2026" }), rejectsWith(/YYYY-MM-DD/));
  assert.throws(() => validateNewJob({ postingText: "x", deadline: "2026-02-30" }), rejectsWith(/YYYY-MM-DD/));
  assert.throws(() => validateNewJob({ postingText: "x", sourceUrl: "javascript:alert(1)" }), rejectsWith(/http/));
  assert.throws(() => validateNewJob({ postingText: "x", interest: 6 }), rejectsWith(/Interest/));
  assert.throws(() => validateNewJob({ postingText: "x", companySize: "huge" }), rejectsWith(/company size/));
  const ok = validateNewJob({ postingText: "x", sourceUrl: "https://example.com/job/1", deadline: "2026-12-01" });
  assert.equal(ok.companySize, "unknown");
  assert.equal(ok.deadline, "2026-12-01");
});

/* ---------- Analysis ---------- */

test("analysis fills blanks, never overwrites owner input, and writes requirements", async () => {
  const user = "analyze-user";
  const job = await createJob(db, user, { postingText: POSTING, company: "Owner Co", compText: "Owner's pay note", companySize: "startup" });
  const result = await analyzeJob(db, user, job.id);

  const saved = (await getJob(db, user, job.id))!;
  // Owner-entered fields are untouched.
  assert.equal(saved.company, "Owner Co");
  assert.equal(saved.compText, "Owner's pay note");
  assert.equal(saved.companySize, "startup");
  // Blanks are filled from the posting.
  assert.equal(saved.title, "Implementation Manager");
  assert.equal(saved.location, "Denver, CO (Hybrid)");
  assert.equal(saved.remoteType, "hybrid");
  assert.equal(saved.compMin, 85000);
  assert.equal(saved.compMax, 100000);
  assert.equal(saved.deadline, "2026-12-01");
  assert.equal(saved.requisitionId, "R-2044");
  assert.equal(saved.careerPath, "implementation");
  assert.ok(saved.analyzedAt);
  assert.equal(saved.promptVersion, ANALYZE_VERSION);
  assert.match(saved.model, /^fake:/);
  assert.deepEqual(saved.analysis?.screeningQuestions, ["Are you authorized to work in the US?"]);
  assert.deepEqual(saved.analysis?.tools, ["Salesforce"]);

  const reqs = await listRequirements(db, user, job.id);
  assert.equal(result.requirements, reqs.length);
  const byKind = (kind: string) => reqs.filter((r) => r.kind === kind).map((r) => r.text);
  assert.deepEqual(byKind("must"), ["3+ years leading client programs", "Excellent stakeholder communication"]);
  assert.deepEqual(byKind("preferred"), ["Experience with Salesforce"]);
  assert.equal(byKind("responsibility").length, 2);
  assert.deepEqual(byKind("screening"), ["Are you authorized to work in the US?"]);
  assert.deepEqual(reqs.map((r) => r.position), reqs.map((_, i) => i));

  const runs = await db.select().from(aiRuns).where(and(eq(aiRuns.userId, user), eq(aiRuns.task, "analyze")));
  assert.equal(runs.length, 1);
});

test("mergeAnalysis leaves owner values alone and sets career path only on first analysis", async () => {
  const user = "merge-user";
  const job = await createJob(db, user, { postingText: POSTING, title: "My title", deadline: "2026-11-01" });
  const output = { ...fakeAnalysis(POSTING), compMin: 120000, compMax: 90000, deadline: "not a date" };
  const patch = mergeAnalysis(job, output);
  assert.equal(patch.title, undefined);
  assert.equal(patch.deadline, undefined);
  assert.equal(patch.company, "Acme Health");
  // Swapped into order.
  assert.equal(patch.compMin, 90000);
  assert.equal(patch.compMax, 120000);
  assert.equal(patch.careerPath, "implementation");
  assert.equal(mergeAnalysis({ ...job, analyzedAt: new Date() }, output).careerPath, undefined);
  // Hourly-looking numbers aren't treated as salaries.
  assert.equal(mergeAnalysis(job, { ...output, compMin: 45, compMax: 55 }).compMin, undefined);
});

test("fake analysis files strength & conditioning postings under their own path, even when they mention wellness", () => {
  const posting = "Tactical Strength and Conditioning Coach\nNavy Region Southwest — San Diego, CA\nDeliver human performance programming and support the base wellness program.\nRequired: CSCS";
  assert.equal(fakeAnalysis(posting).careerPath, "strength_conditioning");
  assert.equal(fakeAnalysis("Employee Wellness Program Manager\nRun our benefits and wellness programs.").careerPath, "employer_wellbeing");
});

test("pay parsing handles ranges, k suffixes and hourly rates", () => {
  assert.deepEqual(parseCompRange("Salary: $85,000 - $100,000").min, 85000);
  assert.deepEqual(parseCompRange("$85k–$100k"), { min: 85000, max: 100000, text: "$85k–$100k" });
  assert.equal(parseCompRange("$90,000 base").max, 90000);
  assert.equal(parseCompRange("$28 - $32 per hour").min, null);
  assert.equal(parseCompRange("competitive").min, null);
});

/* ---------- Matching ---------- */

async function seedLibrary(user: string) {
  const [role] = await db.insert(roles).values({ userId: user, employer: "Peak Performance", title: "Head Coach", isCurrent: true, factStatus: "verified" }).returning();
  const [a1] = await db
    .insert(achievements)
    .values({ userId: user, roleId: role.id, headline: "Led onboarding programs for 40 new athletes each season", factStatus: "verified" })
    .returning();
  const [a2] = await db
    .insert(achievements)
    .values({ userId: user, roleId: role.id, headline: "Ran parent workshops on recovery", tags: ["stakeholder"], factStatus: "verified" })
    .returning();
  return { a1, a2 };
}

test("matching labels requirements, cites real achievements and respects overrides", async () => {
  const user = "match-user";
  const { a1, a2 } = await seedLibrary(user);
  const job = await createJob(db, user, { postingText: POSTING });

  await assert.rejects(matchEvidence(db, user, job.id), rejectsWith(/Analyze the posting first/));
  await analyzeJob(db, user, job.id);

  const before = await listRequirements(db, user, job.id);
  const salesforce = before.find((r) => r.text === "Experience with Salesforce")!;
  await overrideRequirementLabel(db, user, salesforce.id, "strong");

  const counts = await matchEvidence(db, user, job.id);
  assert.equal(counts.skipped, 1);

  const reqs = await listRequirements(db, user, job.id);
  const find = (text: string) => reqs.find((r) => r.text === text)!;

  // "onboarding" + "programs" overlap with a1 → strong.
  const onboarding = find("Lead onboarding programs for new employer clients");
  assert.equal(onboarding.label, "strong");
  assert.equal(onboarding.achievementIds[0], a1.id);
  assert.equal(onboarding.translation, "");

  // Only "workshops" overlaps with a2 → transferable, with a translation.
  const workshops = find("Build training materials and run workshops for client stakeholders");
  assert.equal(workshops.label, "transferable");
  assert.deepEqual(workshops.achievementIds, [a2.id]);
  assert.ok(workshops.translation.length > 0);

  // "stakeholder" is one of a2's tags → transferable; "programs" → a1.
  assert.equal(find("Excellent stakeholder communication").label, "transferable");
  assert.deepEqual(find("3+ years leading client programs").achievementIds, [a1.id]);
  assert.deepEqual(counts, { strong: 1, transferable: 3, gap: 0, skipped: 1 });

  // The owner's call is untouched.
  const kept = find("Experience with Salesforce");
  assert.equal(kept.label, "strong");
  assert.equal(kept.labelOverridden, true);
  assert.deepEqual(kept.achievementIds, []);

  // Screening questions are never matched.
  assert.equal(find("Are you authorized to work in the US?").label, null);

  const saved = (await getJob(db, user, job.id))!;
  assert.ok(saved.matchedAt);
  const runs = await db.select().from(aiRuns).where(and(eq(aiRuns.userId, user), eq(aiRuns.task, "match")));
  assert.equal(runs.length, 1);
  assert.equal(runs[0].promptVersion, MATCH_VERSION);
});

test("applyMatches drops invented aliases and downgrades unsupported labels to gap", () => {
  const targets: MatchTarget[] = [
    { id: "req-1", alias: "Q1", text: "a", kind: "must" },
    { id: "req-2", alias: "Q2", text: "b", kind: "must" },
    { id: "req-3", alias: "Q3", text: "c", kind: "preferred" },
    { id: "req-4", alias: "Q4", text: "d", kind: "tool" },
    { id: "req-5", alias: "Q5", text: "e", kind: "tool" },
  ];
  const library = new Map([
    ["A1", { id: "ach-1" }],
    ["A2", { id: "ach-2" }],
  ]);
  const updates = applyMatches(
    targets,
    {
      matches: [
        { requirement: "q1", label: "strong", achievementIds: ["A1", "A99", " a2 "], rationale: "Direct.", translation: "should be cleared" },
        { requirement: "Q2", label: "strong", achievementIds: ["A42"], rationale: "Invented.", translation: "" },
        { requirement: "Q3", label: "transferable", achievementIds: ["A2"], rationale: "Similar.", translation: "Coaching → onboarding." },
        { requirement: "Q4", label: "gap", achievementIds: ["A1"], rationale: "Missing.", translation: "x" },
        { requirement: "Q77", label: "strong", achievementIds: ["A1"], rationale: "Unknown requirement.", translation: "" },
      ],
    },
    library,
  );
  const byId = new Map(updates.map((u) => [u.id, u]));
  assert.deepEqual(byId.get("req-1"), { id: "req-1", label: "strong", achievementIds: ["ach-1", "ach-2"], rationale: "Direct.", translation: "" });
  assert.equal(byId.get("req-2")!.label, "gap");
  assert.deepEqual(byId.get("req-2")!.achievementIds, []);
  assert.match(byId.get("req-2")!.rationale, /treated as a gap/);
  assert.deepEqual(byId.get("req-3"), { id: "req-3", label: "transferable", achievementIds: ["ach-2"], rationale: "Similar.", translation: "Coaching → onboarding." });
  assert.deepEqual(byId.get("req-4"), { id: "req-4", label: "gap", achievementIds: [], rationale: "Missing.", translation: "" });
  // Claude skipped Q5 → left unmatched rather than guessed.
  assert.equal(byId.get("req-5")!.label, null);
  assert.equal(updates.length, targets.length);
});

test("fake matching uses keyword overlap", async () => {
  const user = "fake-match-user";
  await seedLibrary(user);
  const { buildLibraryContext, loadLibrary } = await import("@/lib/ai/library");
  const context = buildLibraryContext(await loadLibrary(db, user));
  const out = fakeMatch(
    [
      { id: "1", alias: "Q1", text: "Own onboarding programs", kind: "must" },
      { id: "2", alias: "Q2", text: "Host customer workshops", kind: "must" },
      { id: "3", alias: "Q3", text: "SQL reporting", kind: "tool" },
    ],
    context.achievementByAlias,
  );
  assert.deepEqual(
    out.matches.map((m) => [m.requirement, m.label, m.achievementIds]),
    [
      ["Q1", "strong", ["A1"]],
      ["Q2", "transferable", ["A2"]],
      ["Q3", "gap", []],
    ],
  );
});

test("matching needs a library to match against", async () => {
  const user = "empty-library-user";
  const job = await createJob(db, user, { postingText: POSTING });
  await analyzeJob(db, user, job.id);
  await assert.rejects(matchEvidence(db, user, job.id), rejectsWith(/Add achievements/));
});

test("re-analysis keeps the owner's label calls and clears the match date", async () => {
  const user = "reanalyze-user";
  await seedLibrary(user);
  const job = await createJob(db, user, { postingText: POSTING });
  await analyzeJob(db, user, job.id);
  const [first] = (await listRequirements(db, user, job.id)).filter((r) => r.kind === "must");
  await overrideRequirementLabel(db, user, first.id, "gap");
  await matchEvidence(db, user, job.id);
  await analyzeJob(db, user, job.id);
  const again = (await listRequirements(db, user, job.id)).find((r) => r.text === first.text)!;
  assert.equal(again.label, "gap");
  assert.equal(again.labelOverridden, true);
  assert.equal((await getJob(db, user, job.id))!.matchedAt, null);
  // "auto" hands the label back to matching.
  await overrideRequirementLabel(db, user, again.id, "auto");
  const [row] = await db.select().from(jobRequirements).where(eq(jobRequirements.id, again.id));
  assert.equal(row.labelOverridden, false);
});

/* ---------- Fit score ---------- */

const baseJob: FitJob = { compMin: null, compMax: null, location: "", remoteType: "unknown", companySize: "unknown", growth: 3, interest: 3 };

test("fit score: all-neutral inputs land at 50 with visible components", () => {
  const fit = computeFit(baseJob, [], null);
  assert.equal(fit.score, 50);
  assert.equal(fit.components.length, 6);
  assert.equal(fit.components.reduce((sum, c) => sum + c.points, 0), fit.score);
  assert.equal(fit.components.reduce((sum, c) => sum + c.maxPoints, 0), 100);
  for (const c of fit.components) {
    assert.equal(c.weight, 3);
    assert.ok(c.points <= c.maxPoints, `${c.key} over its max`);
    assert.ok(c.detail.length > 0);
  }
});

test("fit score components follow pay, location, evidence, growth and interest", () => {
  const profile = { compMin: 90000, remoteOk: true, targetLocations: ["Denver, CO"], fitWeights: null };
  const value = (job: Partial<FitJob>, reqs: Parameters<typeof computeFit>[1] = [], p: Parameters<typeof computeFit>[2] = profile) =>
    Object.fromEntries(computeFit({ ...baseJob, ...job }, reqs, p).components.map((c) => [c.key, c.value]));

  assert.equal(value({ compMin: 95000, compMax: 110000 }).compensation, 1);
  assert.equal(value({ compMin: 80000, compMax: 95000 }).compensation, 0.75);
  assert.equal(value({ compMin: 60000, compMax: 65000 }).compensation, 0);
  assert.equal(value({}).compensation, 0.5); // pay unknown
  assert.equal(value({ compMin: 60000 }, [], { ...profile, compMin: null }).compensation, 0.5); // no target

  assert.equal(value({ remoteType: "remote" }).location, 1);
  assert.equal(value({ remoteType: "remote" }, [], { ...profile, remoteOk: false }).location, 0.15);
  assert.equal(value({ location: "Denver, Colorado", remoteType: "hybrid" }).location, 1);
  assert.equal(value({ location: "Austin, TX", remoteType: "onsite" }).location, 0.15);
  assert.equal(value({}).location, 0.5);

  const reqs = [
    { kind: "must" as const, label: "strong" as const },
    { kind: "must" as const, label: "transferable" as const },
    { kind: "preferred" as const, label: "gap" as const },
    { kind: "preferred" as const, label: null },
    { kind: "responsibility" as const, label: "gap" as const }, // ignored
  ];
  assert.equal(value({}, reqs).fit, (1 + 0.5 + 0 + 0.5) / 4);
  assert.equal(value({}, [{ kind: "must", label: null }]).fit, 0.5);

  assert.equal(value({ growth: 5, interest: 1 }).growth, 1);
  assert.equal(value({ growth: 5, interest: 1 }).interest, 0);
  assert.equal(value({ companySize: "startup" }).companySize, 0.5);
});

test("fit weights change each component's share", () => {
  const job = { ...baseJob, interest: 5, growth: 1 };
  const weights = { compensation: 0, location: 0, fit: 0, companySize: 0, growth: 1, interest: 3 };
  const fit = computeFit(job, [], { compMin: null, remoteOk: true, targetLocations: [], fitWeights: weights });
  assert.equal(fit.score, 75);
  const interest = fit.components.find((c) => c.key === "interest")!;
  assert.equal(interest.points, 75);
  assert.equal(interest.maxPoints, 75);
  // All-zero weights fall back to equal weights instead of dividing by zero.
  const zero = computeFit(job, [], { compMin: null, remoteOk: true, targetLocations: [], fitWeights: { ...weights, interest: 0, growth: 0 } });
  assert.equal(zero.components[0].weight, 3);
  assert.deepEqual(roundToTotal([16.7, 16.7, 16.6], 50), [17, 17, 16]);
});

/* ---------- Alerts ---------- */

const NOW = new Date("2026-09-29T12:00:00Z");
const alertJob = (overrides: Partial<AlertJob>): AlertJob => ({
  id: "job",
  company: "Acme",
  title: "CSM",
  requisitionId: "",
  deadline: "",
  capturedAt: new Date("2026-09-20T00:00:00Z"),
  postingStatus: "active",
  applicationStatus: "saved",
  ...overrides,
});

test("duplicate alerts: same requisition ID, or same company and title already applied to", () => {
  const job = alertJob({ id: "a", requisitionId: "R-1" });
  const sameReq = alertJob({ id: "b", company: "Other", title: "Other", requisitionId: " r-1 " });
  assert.deepEqual(jobAlerts(job, [job, sameReq], NOW).map((a) => [a.kind, a.relatedJobId]), [["duplicate", "b"]]);

  const plain = alertJob({ id: "c", company: "ACME ", title: "csm" });
  const savedTwin = alertJob({ id: "d", applicationStatus: "saved" });
  assert.deepEqual(jobAlerts(plain, [plain, savedTwin], NOW), []);
  const appliedTwin = alertJob({ id: "e", company: "Acme.", title: "CSM", applicationStatus: "interview" });
  const alerts = jobAlerts(plain, [plain, appliedTwin], NOW);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, "duplicate");
  assert.equal(alerts[0].relatedJobId, "e");
  // Blank company/title never match each other.
  const blank = alertJob({ id: "f", company: "", title: "" });
  assert.deepEqual(jobAlerts(blank, [blank, alertJob({ id: "g", company: "", title: "", applicationStatus: "applied" })], NOW), []);
});

test("stale and closed alerts", () => {
  assert.deepEqual(jobAlerts(alertJob({ deadline: "2026-09-28" }), [], NOW).map((a) => a.label), ["Possibly stale"]);
  assert.deepEqual(jobAlerts(alertJob({ deadline: "2026-09-29" }), [], NOW), []);
  assert.deepEqual(jobAlerts(alertJob({ capturedAt: new Date("2026-08-01T00:00:00Z") }), [], NOW).map((a) => a.kind), ["stale"]);
  assert.deepEqual(jobAlerts(alertJob({ capturedAt: new Date("2026-08-20T00:00:00Z") }), [], NOW), []);
  // Once applied, an old posting isn't flagged.
  assert.deepEqual(jobAlerts(alertJob({ capturedAt: new Date("2026-06-01T00:00:00Z"), applicationStatus: "applied" }), [], NOW), []);
  assert.deepEqual(jobAlerts(alertJob({ postingStatus: "closed", deadline: "2026-01-01" }), [], NOW).map((a) => a.kind), ["closed"]);
  assert.deepEqual(jobAlerts(alertJob({ postingStatus: "stale" }), [], NOW).map((a) => a.label), ["Stale"]);
});

test("the job list ranks by fit and attaches alerts", async () => {
  const user = "list-user";
  await db.insert(profiles).values({ userId: user, compMin: 90000 });
  const low = await createJob(db, user, { postingText: "x", company: "Low", title: "CSM", interest: 1, growth: 1 });
  const high = await createJob(db, user, { postingText: "y", company: "High", title: "CSM", interest: 5, growth: 5, requisitionId: "R-9" });
  await createJob(db, user, { postingText: "z", company: "Dup", title: "AM", requisitionId: "R-9" });
  const list = await listJobs(db, user, NOW);
  assert.equal(list.length, 3);
  assert.equal(list[0].job.id, high.id);
  assert.equal(list.at(-1)!.job.id, low.id);
  assert.ok(list[0].fit.score > list.at(-1)!.fit.score);
  assert.equal(list[0].applicationStatus, "saved");
  assert.equal(list[0].alerts[0]?.kind, "duplicate");
});

/* ---------- Editing and deleting ---------- */

test("fit inputs and posting status update and validate", async () => {
  const user = "edit-user";
  const job = await createJob(db, user, { postingText: "x" });
  await updateJobFit(db, user, job.id, { interest: 4, growth: 2, companySize: "enterprise", careerPath: "account_management" });
  await setPostingStatus(db, user, job.id, "closed");
  const saved = (await getJob(db, user, job.id))!;
  assert.deepEqual([saved.interest, saved.growth, saved.companySize, saved.careerPath, saved.postingStatus], [4, 2, "enterprise", "account_management", "closed"]);
  await assert.rejects(updateJobFit(db, user, job.id, { interest: 0, growth: 2, companySize: "mid", careerPath: "other" }), rejectsWith(/1 to 5/));
  await assert.rejects(updateJobFit(db, user, job.id, { interest: 3, growth: 2, companySize: "mid", careerPath: "astronaut" }), rejectsWith(/career path/));
  await assert.rejects(setPostingStatus(db, user, job.id, "open"), rejectsWith(/posting status/));
});

test("deleting a job is refused once materials were submitted", async () => {
  const user = "delete-user";
  const frozen = await createJob(db, user, { postingText: "x" });
  await db.insert(snapshots).values({ userId: user, kind: "posting", jobId: frozen.id, content: {}, renderedText: "x", contentHash: "h" });
  await assert.rejects(deleteJob(db, user, frozen.id), (error: unknown) => error instanceof JobError && error.message === HAS_SNAPSHOTS_MESSAGE);
  assert.ok(await getJob(db, user, frozen.id));

  const loose = await createJob(db, user, { postingText: "y" });
  await deleteJob(db, user, loose.id);
  assert.equal(await getJob(db, user, loose.id), null);
  assert.equal((await db.select().from(applications).where(eq(applications.jobId, loose.id))).length, 0);
});

test("every job function is scoped to its owner", async () => {
  const owner = "scope-owner";
  const other = "scope-other";
  await seedLibrary(other);
  const job = await createJob(db, owner, { postingText: POSTING });
  await analyzeJob(db, owner, job.id);
  const [req] = await listRequirements(db, owner, job.id);

  assert.equal(await getJob(db, other, job.id), null);
  assert.equal(await getJobDetail(db, other, job.id), null);
  assert.deepEqual(await listRequirements(db, other, job.id), []);
  assert.deepEqual(await listJobs(db, other), []);
  await assert.rejects(analyzeJob(db, other, job.id), rejectsWith(/wasn't found/));
  await assert.rejects(matchEvidence(db, other, job.id), rejectsWith(/wasn't found/));
  await assert.rejects(updateJobFit(db, other, job.id, { interest: 1, growth: 1, companySize: "mid", careerPath: "other" }), rejectsWith(/wasn't found/));
  await assert.rejects(setPostingStatus(db, other, job.id, "closed"), rejectsWith(/wasn't found/));
  await assert.rejects(overrideRequirementLabel(db, other, req.id, "gap"), rejectsWith(/wasn't found/));
  await assert.rejects(deleteJob(db, other, job.id), rejectsWith(/wasn't found/));
  // Malformed ids are "not found", not database errors.
  assert.equal(await getJob(db, owner, "not-a-uuid"), null);

  const still = (await getJob(db, owner, job.id))!;
  assert.equal(still.postingStatus, "active");
  const [unchanged] = await db.select().from(jobRequirements).where(eq(jobRequirements.id, req.id));
  assert.equal(unchanged.labelOverridden, false);
});

test("the job page detail brings requirements, application, fit and cited achievements together", async () => {
  const user = "detail-user";
  const { a1 } = await seedLibrary(user);
  const job = await createJob(db, user, { postingText: POSTING });
  await analyzeJob(db, user, job.id);
  await matchEvidence(db, user, job.id);
  const detail = (await getJobDetail(db, user, job.id))!;
  assert.equal(detail.application?.status, "saved");
  assert.equal(detail.achievementCount, 2);
  assert.ok(detail.requirements.length > 0);
  assert.equal(detail.achievements.get(a1.id)?.headline, a1.headline);
  assert.equal(detail.fit.components.length, 6);
  assert.ok(detail.fit.components.find((c) => c.key === "fit")!.detail.includes("strong"));
});
