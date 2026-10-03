import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import type { Database } from "@/db";
import { achievements, aiRuns, jobLeads, jobSearches, leadSearchMatches, profiles, roles } from "@/db/schema";
import { suggestDirections } from "@/lib/ai/tasks/explore";
import { reviewDiscoverFit, resolveFit } from "@/lib/ai/tasks/discover-fit";
import { payEligibility, workEligibility } from "@/lib/discover/eligibility";
import { explorationInputs, explorationFingerprint, getFitReview, getExploration } from "@/lib/discover/exploration";
import { leadCounts, listLeads, setLeadStatus } from "@/lib/discover/leads";
import { refreshAllUsers, refreshSearches } from "@/lib/discover/refresh";
import { createSearch, deleteSearch } from "@/lib/discover/searches";
import type { FetchLike } from "@/lib/discover/types";
import { testDatabase } from "./helpers";

let db: Database;
let close: () => Promise<void>;
const user = "explore-owner";
const other = "explore-other";
const originalKey = process.env.JSEARCH_API_KEY;

before(async () => ({ db, close } = await testDatabase()));
after(async () => {
  if (originalKey === undefined) delete process.env.JSEARCH_API_KEY;
  else process.env.JSEARCH_API_KEY = originalKey;
  await close();
});

const annualPay = (salaryMin: number | null, salaryMax: number | null, salaryProvenance: "disclosed" | "estimated" | "unknown" = "disclosed") =>
  ({ salaryMin, salaryMax, salaryText: "", salaryProvenance });

test("pay and work rules preserve uncertain postings but exclude clear mismatches", () => {
  assert.equal(payEligibility(annualPay(45000, 60000), 75000).excluded, true);
  assert.equal(payEligibility(annualPay(65000, 80000), 75000).excluded, false);
  assert.equal(payEligibility(annualPay(80000, null), 75000).excluded, false);
  assert.equal(payEligibility(annualPay(45000, null), 75000).excluded, false);
  assert.equal(payEligibility(annualPay(null, null, "unknown"), 75000).excluded, false);
  assert.match(payEligibility(annualPay(45000, 60000, "estimated"), 75000).label, /Estimated/);
  assert.equal(workEligibility({ title: "Sales Development Representative", description: "" }).excluded, true);
  assert.equal(workEligibility({ title: "Program coordinator", description: "Work alongside our sales team." }).excluded, false);
  assert.equal(workEligibility({ title: "Program coordinator", description: "You will meet a sales quota each quarter." }).excluded, true);
  assert.equal(workEligibility({ title: "Program coordinator", description: "You will coordinate events." }).label, "Check work type");
});

test("manual Explore refresh shares one posting across modes; cron remains priority-only", async () => {
  process.env.JSEARCH_API_KEY = "fixture-key";
  await db.insert(profiles).values({ userId: user, compMin: 75000, targetLocations: ["Tampa, FL"], remoteOk: true });
  const priority = await createSearch(db, user, { query: "program coordinator", mode: "priority", sources: ["jsearch"] });
  const explore = await createSearch(db, user, { query: "program coordinator", mode: "explore", directionTerms: ["program coordinator"], sources: ["jsearch"] });
  const body = JSON.stringify({ status: "OK", data: [{ job_id: "shared-1", job_title: "Program Coordinator", employer_name: "Acme",
    job_publisher: "Company", job_apply_link: "https://example.com/job/1", job_description: "Coordinate schedules in an office-based team.",
    job_location: "Tampa, FL", job_is_remote: false, job_posted_at_datetime_utc: new Date().toISOString(), job_min_salary: 85000,
    job_max_salary: 95000, job_salary_period: "YEAR" }] });
  let calls = 0;
  const fetchImpl: FetchLike = async () => { calls++; return new Response(body, { status: 200 }); };
  await refreshSearches(db, user, { mode: "priority", fetchImpl, force: true });
  assert.equal((await listLeads(db, user, { mode: "priority" })).length, 1);
  assert.equal((await listLeads(db, user, { mode: "explore" })).length, 0);
  await refreshSearches(db, user, { mode: "explore", fetchImpl, force: true });
  assert.equal(calls, 2);
  const secondExplore = await createSearch(db, user, { query: "program administrator", mode: "explore", directionTerms: ["program coordinator"], sources: ["jsearch"] });
  await refreshSearches(db, user, { mode: "explore", searchId: secondExplore.id, fetchImpl, force: true });
  assert.equal(calls, 3);
  const [priorityLead] = await listLeads(db, user, { mode: "priority" });
  const [exploreLead] = await listLeads(db, user, { mode: "explore" });
  assert.equal(priorityLead.id, exploreLead.id);
  assert.equal((await db.select().from(jobLeads).where(eq(jobLeads.userId, user))).length, 1);
  assert.equal((await db.select().from(leadSearchMatches).where(eq(leadSearchMatches.userId, user))).length, 3);
  assert.equal(exploreLead.eligibility?.excluded, false);
  await setLeadStatus(db, user, priorityLead.id, "dismissed");
  assert.equal((await leadCounts(db, user, { mode: "explore" })).dismissed, 1);
  await deleteSearch(db, user, explore.id);
  assert.equal((await listLeads(db, user, { mode: "explore", status: "dismissed" })).length, 1);
  assert.equal((await listLeads(db, user, { mode: "explore", searchId: secondExplore.id, status: "dismissed" })).length, 1);
  assert.equal((await db.select().from(jobSearches).where(eq(jobSearches.id, priority.id))).length, 1);
  const before = calls;
  await refreshAllUsers(db, { fetchImpl });
  assert.equal(calls, before, "cron must not run the Explore search, and priority is throttled");
  assert.equal((await listLeads(db, other, { mode: "explore", status: "all" })).length, 0);
  await createSearch(db, other, { query: "program coordinator", mode: "explore", sources: ["jsearch"] });
  const cron = await refreshAllUsers(db, { fetchImpl });
  assert.equal(cron.users, 1, "a user with only Explore searches must not be scheduled");
  assert.equal(calls, before);
});

test("suggestions and fit reviews cite real library evidence and become stale after edits", async () => {
  const [role] = await db.insert(roles).values({ userId: user, employer: "A", title: "Coach", factStatus: "verified" }).returning();
  await db.insert(achievements).values({ userId: user, roleId: role.id, headline: "Coordinated a program", factStatus: "verified" });
  const directions = await suggestDirections(db, user);
  assert.equal(directions.length, 1);
  assert.ok(directions[0].strengths[0].achievementIds.length);
  const saved = await getExploration(db, user);
  assert.equal(saved?.directions.length, 1);
  const lead = (await db.select().from(jobLeads).where(eq(jobLeads.userId, user)))[0];
  const review = await reviewDiscoverFit(db, user, lead.id);
  assert.equal(review.workType.assessment, "unknown");
  assert.ok(review.unknowns.some((s) => /advancement/.test(s)));
  const stored = await getFitReview(db, user, lead.id);
  assert.ok(stored);
  assert.equal(stored.inputFingerprint, explorationFingerprint(await explorationInputs(db, user), "discover-fit@1", lead));
  await db.update(profiles).set({ compMin: 90000 }).where(eq(profiles.userId, user));
  assert.notEqual(stored.inputFingerprint, explorationFingerprint(await explorationInputs(db, user), "discover-fit@1", lead));
  assert.equal((await db.select().from(aiRuns).where(eq(aiRuns.userId, user))).filter((run) => ["explore", "discover-fit"].includes(run.task)).length, 2);

  const inputs = await explorationInputs(db, user);
  const unsafe = resolveFit({ summary: "", strengths: [{ text: "Invented", achievementAliases: ["A999"], roleAliases: [], postingQuote: "Coordinate schedules" }],
    gaps: [], preparation: "", trainingMonths: null, workType: { assessment: "desk", explanation: "", postingQuote: "made up evidence" },
    growthSignals: [{ text: "Promotion", postingQuote: "made up promotion" }], careerPossibilities: "", unknowns: [] }, inputs, "Coordinate schedules in an office-based team.");
  assert.equal(unsafe.strengths.length, 0);
  assert.equal(unsafe.workType.assessment, "unknown");
  assert.equal(unsafe.growthSignals.length, 0);
});
