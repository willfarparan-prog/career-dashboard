import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import type { Database } from "@/db";
import { achievements, aiRuns, applications, careerImports, jobs, learningItems, qualityFindings, resumeBullets, resumeDrafts, roles, snapshots } from "@/db/schema";
import { dueState, parseDay } from "@/lib/applications/dates";
import { gettingStarted, needsAttention, nextActions, overviewStats, upcomingDeadlines } from "@/lib/overview/dashboard";
import { spendSummary } from "@/lib/overview/spend";
import { testDatabase } from "./helpers";

let db: Database;
let close: () => Promise<void>;
before(async () => ({ db, close } = await testDatabase()));
after(async () => close());

const NOW = new Date("2026-09-29T15:00:00Z");

async function job(userId: string, values: Partial<typeof jobs.$inferInsert> = {}, application: Partial<typeof applications.$inferInsert> | null = {}) {
  const [row] = await db.insert(jobs).values({ userId, company: "Co", title: "Role", postingText: "x", ...values }).returning();
  const [app] = application ? await db.insert(applications).values({ userId, jobId: row.id, ...application }).returning() : [null];
  return { job: row, application: app };
}

test("date helpers", () => {
  assert.equal(parseDay("2026-10-03"), "2026-10-03");
  assert.equal(parseDay("2026-02-30"), null);
  assert.equal(parseDay("Oct 3, 2026"), "2026-10-03");
  assert.equal(parseDay("whenever"), null);
  assert.equal(dueState("2026-09-28", "2026-09-29"), "overdue");
  assert.equal(dueState("2026-09-29", "2026-09-29"), "today");
  assert.equal(dueState("2026-10-06", "2026-09-29"), "soon");
  assert.equal(dueState("2026-10-07", "2026-09-29"), "later");
});

test("next actions: overdue and within 7 days, sorted, open applications only", async () => {
  const user = "next-user";
  await job(user, { company: "Later" }, { nextAction: "Too far", nextActionDate: "2026-10-07" });
  await job(user, { company: "Soon" }, { nextAction: "Prep interview", nextActionDate: "2026-10-06", status: "interview" });
  await job(user, { company: "Overdue" }, { nextAction: "Follow up", nextActionDate: "2026-09-20", status: "applied" });
  await job(user, { company: "Today" }, { nextAction: "Send thank-you", nextActionDate: "2026-09-29" });
  await job(user, { company: "Closed" }, { nextAction: "n/a", nextActionDate: "2026-09-25", status: "rejected" });
  await job(user, { company: "Undated" }, { nextAction: "Someday" });
  await job("another-user", { company: "Not mine" }, { nextAction: "x", nextActionDate: "2026-09-29" });

  const items = await nextActions(db, user, NOW);
  assert.deepEqual(
    items.map((item) => [item.company, item.daysLeft]),
    [
      ["Overdue", -9],
      ["Today", 0],
      ["Soon", 7],
    ],
  );
});

test("upcoming deadlines: next 14 days, not yet applied", async () => {
  const user = "deadline-user";
  await job(user, { company: "In window", deadline: "2026-10-10" });
  await job(user, { company: "Today", deadline: "2026-09-29" }, { status: "ready" });
  await job(user, { company: "No application row", deadline: "Oct 13, 2026" }, null);
  await job(user, { company: "Edge", deadline: "2026-10-13" }, { status: "drafting" });
  await job(user, { company: "Too far", deadline: "2026-10-14" });
  await job(user, { company: "Passed", deadline: "2026-09-28" });
  await job(user, { company: "Applied", deadline: "2026-10-01" }, { status: "applied" });
  await job(user, { company: "Closed posting", deadline: "2026-10-01", postingStatus: "closed" });
  await job(user, { company: "Freeform", deadline: "rolling" });

  const items = await upcomingDeadlines(db, user, NOW);
  assert.deepEqual(
    items.map((item) => [item.company, item.date, item.daysLeft]),
    [
      ["Today", "2026-09-29", 0],
      ["In window", "2026-10-10", 11],
      ["Edge", "2026-10-13", 14],
      ["No application row", "2026-10-13", 14],
    ],
  );
});

test("needs attention: unanalyzed/unmatched open jobs, unfinished drafts, achievements", async () => {
  const user = "attention-user";
  const fresh = await job(user, { company: "Fresh" });
  const analyzed = await job(user, { company: "Analyzed", analyzedAt: NOW });
  const done = await job(user, { company: "Done", analyzedAt: NOW, matchedAt: NOW });
  await job(user, { company: "Applied already" }, { status: "applied" });
  await job(user, { company: "Closed" }, { status: "withdrawn" });

  const [role] = await db.insert(roles).values({ userId: user, employer: "Gym", title: "Coach" }).returning();
  const [withProposed] = await db.insert(resumeDrafts).values({ userId: user, jobId: done.job.id, name: "Proposed draft" }).returning();
  await db.insert(resumeBullets).values([
    { userId: user, draftId: withProposed.id, roleId: role.id, text: "a", originalText: "a", state: "proposed" },
    { userId: user, draftId: withProposed.id, roleId: role.id, text: "b", originalText: "b", state: "proposed" },
    { userId: user, draftId: withProposed.id, roleId: role.id, text: "c", originalText: "c", state: "accepted" },
  ]);
  const [withError] = await db.insert(resumeDrafts).values({ userId: user, jobId: done.job.id, name: "Error draft" }).returning();
  await db.insert(qualityFindings).values([
    { userId: user, draftId: withError.id, kind: "k", severity: "error", message: "bad", source: "rule" },
    { userId: user, draftId: withError.id, kind: "k", severity: "warning", message: "meh", source: "rule" },
  ]);
  const [clean] = await db.insert(resumeDrafts).values({ userId: user, jobId: done.job.id, name: "Clean draft" }).returning();
  await db.insert(qualityFindings).values({ userId: user, draftId: clean.id, kind: "k", severity: "error", message: "fixed", source: "rule", resolved: true });

  await db.insert(achievements).values([
    { userId: user, headline: "a", factStatus: "needs_confirmation" },
    { userId: user, headline: "b", factStatus: "needs_confirmation", missingMetrics: ["how many clients"] },
    { userId: user, headline: "c", factStatus: "verified" },
  ]);

  const items = await needsAttention(db, user);
  const byKey = new Map(items.map((item) => [item.key, item]));
  assert.equal(byKey.get(`analyze-${fresh.job.id}`)?.href, `/jobs/${fresh.job.id}`);
  assert.equal(byKey.get(`match-${analyzed.job.id}`)?.kind, "job_match");
  assert.ok(!byKey.has(`analyze-${done.job.id}`) && !byKey.has(`match-${done.job.id}`));
  assert.equal(items.filter((item) => item.kind === "job_analysis" || item.kind === "job_match").length, 2, "applied/closed jobs are skipped");

  assert.equal(byKey.get(`draft-${withProposed.id}`)?.detail, "2 bullets to review");
  assert.equal(byKey.get(`draft-${withProposed.id}`)?.href, `/jobs/${done.job.id}/resume/${withProposed.id}`);
  assert.equal(byKey.get(`draft-${withError.id}`)?.detail, "1 unresolved error");
  assert.equal(byKey.get(`draft-${withError.id}`)?.tone, "bad");
  assert.ok(!byKey.has(`draft-${clean.id}`));

  assert.match(byKey.get("achievements-confirm")?.label ?? "", /^2 achievements need confirmation/);
  assert.match(byKey.get("achievements-metrics")?.label ?? "", /^1 achievement is missing metrics/);
  assert.deepEqual(await needsAttention(db, "empty-user"), []);
});

test("stats, spend and the getting-started checklist", async () => {
  const user = "stats-user";
  const empty = await gettingStarted(db, user);
  assert.equal(empty.done, false);
  assert.ok(empty.steps.every((step) => !step.done));
  assert.deepEqual(empty.steps.map((step) => step.key), ["learn", "import", "verify", "job", "draft", "export", "applied"]);

  await job(user, {}, { status: "saved" });
  await job(user, {}, { status: "interview", submittedAt: new Date("2026-09-10T12:00:00Z") });
  await job(user, {}, { status: "applied", submittedAt: new Date("2026-08-30T12:00:00Z") });
  await job(user, {}, { status: "rejected", submittedAt: new Date("2026-09-02T12:00:00Z") });
  assert.deepEqual(await overviewStats(db, user, NOW), { active: 3, appliedThisMonth: 2, interviews: 1 });

  await db.insert(aiRuns).values([
    { userId: user, task: "a", model: "m", promptVersion: "p", status: "ok", costUsd: 0.25, createdAt: new Date("2026-09-29T01:00:00Z") },
    { userId: user, task: "a", model: "m", promptVersion: "p", status: "ok", costUsd: 0.5, createdAt: new Date("2026-09-05T01:00:00Z") },
    { userId: user, task: "a", model: "m", promptVersion: "p", status: "ok", costUsd: 9, createdAt: new Date("2026-08-31T23:00:00Z") },
  ]);
  const spend = await spendSummary(db, user, NOW);
  assert.equal(spend.today, 0.25);
  assert.equal(spend.month, 0.75);
  assert.equal(spend.runsMonth, 2);

  await db.insert(careerImports).values({ userId: user, source: "paste" });
  await db.insert(achievements).values({ userId: user, headline: "x", factStatus: "verified" });
  const [target] = await db.insert(jobs).values({ userId: user, postingText: "x" }).returning();
  const [draft] = await db.insert(resumeDrafts).values({ userId: user, jobId: target.id, name: "v1", status: "approved" }).returning();
  const partial = await gettingStarted(db, user);
  assert.deepEqual(partial.steps.filter((step) => !step.done).map((step) => step.key), ["learn", "applied"]);
  assert.equal(partial.steps.find((step) => step.key === "applied")?.href, `/jobs/${target.id}#application`);
  assert.equal(partial.steps.find((step) => step.key === "export")?.href, `/jobs/${target.id}/resume/${draft.id}`);

  const [app] = await db.insert(applications).values({ userId: user, jobId: target.id }).returning();
  const [snap] = await db.insert(snapshots).values({ userId: user, kind: "resume", jobId: target.id, content: {}, renderedText: "x", contentHash: "h" }).returning();
  await db.update(applications).set({ resumeSnapshotId: snap.id, status: "applied" }).where(eq(applications.id, app.id));
  assert.equal((await gettingStarted(db, user)).done, false);
  await db.insert(learningItems).values({ userId: user, key: "guide:customer_success:workflow", status: "done" });
  assert.equal((await gettingStarted(db, user)).done, true);
});
