import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Database } from "@/db";
import { applications, jobRequirements, jobs } from "@/db/schema";
import { gapRoadmap } from "@/lib/learn/gaps";
import { hasReadAGuide, isKnownKey, listProgress, setProgress, summarize } from "@/lib/learn/progress";
import { findTerms } from "@/lib/learn/terms";
import { testDatabase } from "./helpers";

let db: Database;
let close: () => Promise<void>;
before(async () => ({ db, close } = await testDatabase()));
after(async () => close());

test("findTerms: whole words, any case, aliases, in order of appearance", () => {
  assert.deepEqual(findTerms("Own NRR and gross retention; partner on renewals in Salesforce."), ["nrr", "grr", "renewal", "salesforce"]);
  // Never inside another word.
  assert.deepEqual(findTerms("A compelling narrative about rapid growth."), []);
  // Hyphens and spaces are interchangeable; matching ignores case.
  assert.deepEqual(findTerms("Support post go-live HYPERCARE and the go live checklist"), ["go-live", "hypercare"]);
  assert.deepEqual(findTerms("Comfortable with Excel pivot tables and Monday.com"), ["spreadsheets", "pm-tools"]);
  assert.deepEqual(findTerms(""), []);
});

async function job(userId: string, company: string, status: (typeof applications.$inferInsert)["status"] | null, requirements: Array<{ kind: "must" | "preferred" | "tool"; text: string; label: "strong" | "transferable" | "gap" }>) {
  const [row] = await db.insert(jobs).values({ userId, company, title: "CSM", postingText: "x" }).returning();
  if (status) await db.insert(applications).values({ userId, jobId: row.id, status });
  await db.insert(jobRequirements).values(requirements.map((r) => ({ userId, jobId: row.id, ...r })));
  return row;
}

test("gap roadmap: groups by term, ranks by jobs then must-haves, skips closed applications and other users", async () => {
  const user = "gap-user";
  await job(user, "Acme", "saved", [
    { kind: "must", text: "3+ years using Salesforce", label: "gap" },
    { kind: "preferred", text: "Experience building QBR decks", label: "transferable" },
    { kind: "must", text: "Coaching mindset", label: "strong" },
  ]);
  await job(user, "Beta", null, [
    { kind: "tool", text: "Salesforce (SFDC)", label: "gap" },
    { kind: "must", text: "Gainsight administration", label: "gap" },
    { kind: "must", text: "Experience with QBRs", label: "gap" },
  ]);
  await job(user, "Gamma", "applied", [{ kind: "preferred", text: "Fluent in Portuguese!", label: "gap" }]);
  await job(user, "Closed", "rejected", [{ kind: "must", text: "Gainsight", label: "gap" }]);
  await job("someone-else", "Theirs", "saved", [{ kind: "must", text: "Salesforce", label: "gap" }]);

  const { topics, jobsConsidered } = await gapRoadmap(db, user);
  assert.equal(jobsConsidered, 3);
  const summary = topics.map((t) => [t.id, t.gapJobs.length, t.mustJobs, t.transferableJobs.length]);
  assert.deepEqual(summary, [
    ["term:salesforce", 2, 1, 0],
    // Tied on gaps and must-haves; transferable evidence elsewhere breaks the tie.
    ["term:qbr", 1, 1, 1],
    ["term:cs-platform", 1, 1, 0],
    ["text:fluent in portuguese", 1, 0, 0],
  ]);
  const salesforce = topics[0];
  assert.equal(salesforce.label, "Salesforce");
  assert.deepEqual(salesforce.examples, ["3+ years using Salesforce", "Salesforce (SFDC)"]);
  assert.ok(salesforce.resources.some((r) => r.key === "trailhead-crm"));
  assert.equal(topics[3].label, "Fluent in Portuguese!");
  assert.deepEqual(topics[3].resources, []);
});

test("progress: only real content keys, upsert, clear, summary", async () => {
  const user = "progress-user";
  assert.equal(isKnownKey("term:nrr"), true);
  assert.equal(isKnownKey("term:made-up"), false);
  assert.equal(isKnownKey("guide:customer_success:workflow"), true);
  assert.equal(isKnownKey("guide:other:workflow"), false);
  assert.equal(isKnownKey("resource:trailhead-crm"), true);
  assert.equal(isKnownKey("resource:trailhead-crm:extra"), false);
  await assert.rejects(setProgress(db, user, "term:made-up", "confident"));

  assert.equal(await hasReadAGuide(db, user), false);
  await setProgress(db, user, "term:nrr", "learning");
  await setProgress(db, user, "term:nrr", "confident");
  await setProgress(db, user, "resource:trailhead-crm", "learning");
  await setProgress(db, user, "resource:google-pm", "done");
  await setProgress(db, user, "guide:implementation:workflow", "done");
  await setProgress(db, "other-user", "term:grr", "confident");

  const progress = await listProgress(db, user);
  assert.equal(progress.get("term:nrr"), "confident");
  assert.equal(progress.has("term:grr"), false);
  assert.equal(await hasReadAGuide(db, user), true);
  const summary = summarize(progress);
  assert.deepEqual({ ...summary, termsTotal: 0 }, { termsKnown: 1, termsTotal: 0, sectionsDone: 1, resourcesDone: 1, resourcesStarted: 1 });

  await setProgress(db, user, "term:nrr", null);
  assert.equal((await listProgress(db, user)).has("term:nrr"), false);
});
