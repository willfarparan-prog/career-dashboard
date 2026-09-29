import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { rowsOf, type Database } from "@/db";
import { achievements, aiRuns, jobs, profiles, roles, snapshots } from "@/db/schema";
import { isOwner } from "@/lib/auth/policy";
import { buildLibraryContext, loadLibrary, resolveAliases } from "@/lib/ai/library";
import { estimateCost } from "@/lib/ai/models";
import { runStructured } from "@/lib/ai/run";
import { z } from "zod";
import { TEST_USER, testDatabase } from "./helpers";

let db: Database;
let close: () => Promise<void>;
before(async () => ({ db, close } = await testDatabase()));
after(async () => close());

test("owner gate needs the configured email AND a verified address", () => {
  assert.equal(isOwner("Will@Example.com", true, "will@example.com"), true);
  assert.equal(isOwner("will@example.com", false, "will@example.com"), false);
  assert.equal(isOwner("will@example.com", undefined, "will@example.com"), false);
  assert.equal(isOwner("someone@example.com", true, "will@example.com"), false);
  assert.equal(isOwner("will@example.com", true, undefined), false);
});

test("migrations build every table the schema declares", async () => {
  const result = await db.execute(sql`select table_name from information_schema.tables where table_schema = 'public'`);
  const tables = new Set(rowsOf<{ table_name: string }>(result).map((row) => row.table_name));
  for (const name of ["profiles", "roles", "credentials", "skills", "achievements", "career_imports", "jobs", "job_requirements", "resume_drafts", "resume_bullets", "quality_findings", "cover_letters", "applications", "snapshots", "ai_runs"]) {
    assert.ok(tables.has(name), `missing table ${name}`);
  }
});

/** Drizzle wraps driver errors; the database's own message is on `cause`. */
const dbError = (pattern: RegExp) => (error: unknown) => pattern.test(String((error as { cause?: Error })?.cause?.message ?? error));

test("snapshots refuse UPDATE and DELETE, but purge_user_data removes them", async () => {
  const [job] = await db.insert(jobs).values({ userId: TEST_USER, postingText: "x" }).returning();
  const [snap] = await db.insert(snapshots).values({ userId: TEST_USER, kind: "posting", jobId: job.id, content: {}, renderedText: "x", contentHash: "h" }).returning();
  await assert.rejects(db.update(snapshots).set({ renderedText: "changed" }).where(eq(snapshots.id, snap.id)), dbError(/immutable/));
  await assert.rejects(db.delete(snapshots).where(eq(snapshots.id, snap.id)), dbError(/immutable/));
  await assert.rejects(db.delete(jobs).where(eq(jobs.id, job.id)));
  await db.execute(sql`select purge_user_data(${TEST_USER})`);
  assert.equal((await db.select().from(snapshots).where(eq(snapshots.userId, TEST_USER))).length, 0);
  assert.equal((await db.select().from(jobs).where(eq(jobs.userId, TEST_USER))).length, 0);
});

test("the library context withholds private facts and maps aliases back to ids", async () => {
  await db.insert(profiles).values({ userId: TEST_USER, fullName: "Test Person" });
  const [role] = await db.insert(roles).values({ userId: TEST_USER, employer: "Gym", title: "Head Coach", start: "2020-01", isCurrent: true, factStatus: "verified" }).returning();
  const [shown] = await db.insert(achievements).values({ userId: TEST_USER, roleId: role.id, headline: "Built onboarding program", factStatus: "verified" }).returning();
  await db.insert(achievements).values({ userId: TEST_USER, roleId: role.id, headline: "Secret thing", factStatus: "private" });
  const context = buildLibraryContext(await loadLibrary(db, TEST_USER));
  assert.match(context.text, /\[R1\] Head Coach — Gym/);
  assert.match(context.text, /\[A1\] Built onboarding program/);
  assert.doesNotMatch(context.text, /Secret thing/);
  assert.deepEqual(resolveAliases(["a1", "A9"], context.achievementByAlias), [shown.id]);
  const withPrivate = buildLibraryContext(await loadLibrary(db, TEST_USER), { includePrivate: true });
  assert.match(withPrivate.text, /Secret thing/);
});

test("fake mode returns schema-checked output and logs the run", async () => {
  const result = await runStructured({
    userId: TEST_USER,
    task: "test",
    promptVersion: "test@1",
    schema: z.object({ answer: z.string() }),
    instructions: "",
    content: "hi",
    effort: "low",
    fake: () => ({ answer: "ok" }),
  });
  assert.equal(result.output.answer, "ok");
  const runs = await db.select().from(aiRuns).where(eq(aiRuns.task, "test"));
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, "ok");
});

test("cost estimate uses per-model prices", () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 };
  assert.equal(estimateCost("claude-opus-5-5", usage), 24);
  assert.equal(estimateCost("claude-sonnet-5-5", usage), 12);
});
