import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { rowsOf, type Database } from "@/db";
import {
  achievements,
  aiRuns,
  applications,
  careerImports,
  coverLetters,
  credentials,
  discoverRuns,
  jobLeads,
  jobRequirements,
  jobSearches,
  interviewPreps,
  interviews,
  jobs,
  learningItems,
  practiceAttempts,
  profiles,
  qualityFindings,
  resumeBullets,
  resumeDrafts,
  roles,
  skills,
  snapshots,
  stories,
} from "@/db/schema";
import { markApplied } from "@/lib/applications/mark-applied";
import { exportUserData, purgeUserData } from "@/lib/settings/data";
import { clearImportText, countStoredImportText, getPrivacySettings, updatePrivacySettings } from "@/lib/settings/privacy";
import { TEST_USER, testDatabase } from "./helpers";

let db: Database;
let close: () => Promise<void>;
before(async () => ({ db, close } = await testDatabase()));
after(async () => close());

const OTHER_USER = "someone-else";

/** One row in every table for a user, and an applied application (so snapshots exist). */
async function seedEverything(userId: string) {
  await db.insert(profiles).values({ userId, fullName: `Person ${userId}` }).onConflictDoNothing();
  const [role] = await db.insert(roles).values({ userId, employer: "Gym", title: "Coach", factStatus: "verified" }).returning();
  const [achievement] = await db.insert(achievements).values({ userId, roleId: role.id, headline: "Did a thing" }).returning();
  await db.insert(credentials).values({ userId, kind: "certification", name: "CPR" });
  await db.insert(skills).values({ userId, name: `Onboarding ${userId}` });
  await db.insert(careerImports).values({ userId, source: "paste", rawText: "My whole resume" });
  const [job] = await db.insert(jobs).values({ userId, company: "Acme", title: "CSM", postingText: "Posting" }).returning();
  await db.insert(jobRequirements).values({ userId, jobId: job.id, kind: "must", text: "Onboarding" });
  const [application] = await db.insert(applications).values({ userId, jobId: job.id }).returning();
  const [draft] = await db.insert(resumeDrafts).values({ userId, jobId: job.id, name: "v1", summary: "Summary", roleOrder: [role.id] }).returning();
  const [bullet] = await db
    .insert(resumeBullets)
    .values({ userId, draftId: draft.id, roleId: role.id, achievementId: achievement.id, text: "Did a thing.", originalText: "Did a thing.", state: "accepted" })
    .returning();
  await db.insert(qualityFindings).values({ userId, draftId: draft.id, bulletId: bullet.id, kind: "x", severity: "info", message: "ok", source: "rule" });
  const [letter] = await db.insert(coverLetters).values({ userId, jobId: job.id, paragraphs: [{ text: "Hello.", evidence: [] }] }).returning();
  await db.insert(aiRuns).values({ userId, task: "analyze", model: "fake", promptVersion: "analyze@1", status: "ok", costUsd: 0.01 });
  // Discover: a saved search, a posting it found, and the fetch that found it.
  const [search] = await db.insert(jobSearches).values({ userId, name: "CSM", query: "customer success manager" }).returning();
  await db.insert(jobLeads).values({ userId, source: "remotive", externalId: `lead-${userId}`, searchId: search.id, dedupeKey: "acme|csm", title: "CSM", company: "Acme", url: "https://example.com/jobs/1" });
  await db.insert(discoverRuns).values({ userId, source: "remotive", searchId: search.id, query: "customer success manager", status: "ok", requests: 1, found: 1, added: 1 });
  await db.insert(learningItems).values({ userId, key: "term:nrr", status: "confident" });
  // Interview prep: a story, a round, a prep pack and a practice attempt.
  await db.insert(stories).values({ userId, achievementId: achievement.id, title: "A story", action: "Did it" });
  await db.insert(interviews).values({ userId, jobId: job.id, stage: "hiring_manager", date: "2026-10-02" });
  await db.insert(interviewPreps).values({ userId, jobId: job.id, companyNotes: "Notes" });
  await db.insert(practiceAttempts).values({
    userId,
    jobId: job.id,
    question: "Q",
    answer: "A",
    feedback: { star: { situation: true, task: true, action: true, result: true }, specificity: { rating: "ok", note: "" }, result: { rating: "ok", note: "" }, relevance: { rating: "ok", note: "" }, unsupportedClaims: [], rewriteTip: "" },
  });
  const result = await markApplied(db, userId, application.id, { resumeDraftId: draft.id, coverLetterId: letter.id });
  assert.ok(result.ok, result.ok ? "" : result.error);
}

test("privacy toggles default off and upsert the profile row without touching other fields", async () => {
  const fresh = "privacy-user";
  assert.deepEqual(await getPrivacySettings(db, fresh), { sendPrivateToClaude: false, keepImportText: false });

  await updatePrivacySettings(db, fresh, { sendPrivateToClaude: true, keepImportText: false });
  const [created] = await db.select().from(profiles).where(eq(profiles.userId, fresh));
  assert.equal(created.sendPrivateToClaude, true);
  assert.equal(created.keepImportText, false);

  await db.update(profiles).set({ fullName: "Kept Name" }).where(eq(profiles.userId, fresh));
  await updatePrivacySettings(db, fresh, { sendPrivateToClaude: false, keepImportText: true });
  const [updated] = await db.select().from(profiles).where(eq(profiles.userId, fresh));
  assert.equal(updated.fullName, "Kept Name");
  assert.deepEqual(await getPrivacySettings(db, fresh), { sendPrivateToClaude: false, keepImportText: true });
});

test("clearing import text only touches this user's imports", async () => {
  const user = "import-user";
  await db.insert(careerImports).values([
    { userId: user, source: "paste", rawText: "resume one", extraction: { roles: [] } },
    { userId: user, source: "pdf", rawText: "resume two" },
    { userId: user, source: "docx", rawText: null },
    { userId: OTHER_USER, source: "paste", rawText: "someone else's" },
  ]);
  assert.equal(await countStoredImportText(db, user), 2);
  assert.equal(await clearImportText(db, user), 2);
  assert.equal(await countStoredImportText(db, user), 0);
  const rows = await db.select().from(careerImports).where(eq(careerImports.userId, user));
  assert.ok(rows.every((row) => row.rawText === null));
  assert.deepEqual(rows.find((row) => row.source === "paste")?.extraction, { roles: [] });
  assert.equal(await countStoredImportText(db, OTHER_USER), 1);
});

test("data export covers every table and only this user's rows", async () => {
  await seedEverything(TEST_USER);
  await seedEverything(OTHER_USER);
  const data = await exportUserData(db, TEST_USER);

  const result = await db.execute(sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`);
  const dbTables = rowsOf<{ table_name: string }>(result).map((row) => row.table_name).sort();
  assert.deepEqual(Object.keys(data.tables).sort(), dbTables);

  for (const [name, rows] of Object.entries(data.tables)) {
    assert.ok(rows.length > 0, `expected rows in ${name}`);
    for (const row of rows as Array<{ userId: string }>) assert.equal(row.userId, TEST_USER, `${name} leaked another user's row`);
  }
  assert.equal(data.tables.snapshots.length, 3);
  // Survives a JSON round trip (what the download is).
  const parsed = JSON.parse(JSON.stringify(data)) as typeof data;
  assert.equal(parsed.tables.jobs.length, (data.tables.jobs as unknown[]).length);
});

test("purge removes everything for the user, snapshots included, and leaves others alone", async () => {
  const before = await exportUserData(db, OTHER_USER);
  await purgeUserData(db, TEST_USER);
  const gone = await exportUserData(db, TEST_USER);
  for (const [name, rows] of Object.entries(gone.tables)) assert.equal(rows.length, 0, `${name} still has rows`);
  assert.equal((await db.select().from(snapshots).where(eq(snapshots.userId, TEST_USER))).length, 0);

  const others = await exportUserData(db, OTHER_USER);
  assert.deepEqual(
    Object.fromEntries(Object.entries(others.tables).map(([name, rows]) => [name, rows.length])),
    Object.fromEntries(Object.entries(before.tables).map(([name, rows]) => [name, rows.length])),
  );
});
