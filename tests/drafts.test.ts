import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/db";
import { achievements, jobRequirements, jobs, profiles, qualityFindings, resumeBullets, resumeDrafts, roles } from "@/db/schema";
import { buildLibraryContext, loadLibrary } from "@/lib/ai/library";
import {
  addBulletFromAchievement,
  approveDraft,
  duplicateDraft,
  generateDraft,
  listDraftsForJob,
  loadDraftEditor,
  regenerateBullet,
  reviewDraft,
  saveDraftOutput,
  setBulletState,
  setFindingResolved,
  updateBulletText,
} from "@/lib/drafts/service";
import { loadResumeDocument, renderResumeText } from "@/lib/resume/document";
import { TEST_USER, testDatabase } from "./helpers";

let db: Database;
let close: () => Promise<void>;
let jobId: string;
let roleA: string;
let roleB: string;
let achA: string;
let achB: string;

before(async () => {
  ({ db, close } = await testDatabase());
  await db.insert(profiles).values({ userId: TEST_USER, fullName: "Test Person", headline: "Coach moving into customer success", email: "t@example.com" });
  const [a] = await db.insert(roles).values({ userId: TEST_USER, employer: "Peak Performance", title: "Head Coach", start: "2019-03", isCurrent: true, factStatus: "verified" }).returning();
  const [b] = await db.insert(roles).values({ userId: TEST_USER, employer: "City Gym", title: "Trainer", start: "2016-01", end: "2019-02", factStatus: "verified" }).returning();
  roleA = a.id;
  roleB = b.id;
  const [x] = await db.insert(achievements).values({ userId: TEST_USER, roleId: roleA, headline: "Built onboarding program", action: "designed onboarding for new members", outcome: "Raised 90-day retention to 85%", metrics: [{ label: "retention", value: "85", unit: "%", status: "verified" }], factStatus: "verified" }).returning();
  const [y] = await db.insert(achievements).values({ userId: TEST_USER, roleId: roleB, headline: "Ran group classes", action: "led small-group classes", audience: "adults", factStatus: "verified" }).returning();
  achA = x.id;
  achB = y.id;
  const [job] = await db.insert(jobs).values({ userId: TEST_USER, company: "Acme", title: "Customer Success Manager", postingText: "Onboard customers." }).returning();
  jobId = job.id;
  await db.insert(jobRequirements).values({ userId: TEST_USER, jobId, kind: "must", text: "Customer onboarding", label: "strong", achievementIds: [achA], position: 0 });
});
after(async () => close());

test("a draft keeps only real aliases and files bullets under the achievement's own role", async () => {
  const context = buildLibraryContext(await loadLibrary(db, TEST_USER));
  const aliasA = context.achievementAlias.get(achA)!;
  const aliasRoleB = context.roleAlias.get(roleB)!;
  const draftId = await saveDraftOutput(db, TEST_USER, {
    jobId,
    name: "Test",
    careerPath: "customer_success",
    context,
    model: "test",
    promptVersion: "draft@1",
    output: {
      summary: { text: "Coach who builds onboarding.", evidence: [aliasA, "A99"] },
      skills: [{ name: "Onboarding", evidence: [aliasA, "A42"] }],
      roles: [{ role: aliasRoleB, bullets: [{ text: "Designed onboarding for new members, raising retention to 85%.", achievement: aliasA, jobTerms: [] }, { text: "Invented claim.", achievement: "A77", jobTerms: [] }] }],
      notes: ["Add a number for class size."],
    },
  });
  const [draft] = await db.select().from(resumeDrafts).where(eq(resumeDrafts.id, draftId));
  assert.deepEqual(draft.summaryEvidence, [achA]);
  assert.deepEqual(draft.skills[0].evidence, [achA]);
  const bullets = await db.select().from(resumeBullets).where(eq(resumeBullets.draftId, draftId));
  const real = bullets.find((b) => b.achievementId === achA)!;
  assert.equal(real.roleId, roleA, "moved under the achievement's role");
  const invented = bullets.find((b) => b.text === "Invented claim.")!;
  assert.equal(invented.achievementId, null);
  const findings = await db.select().from(qualityFindings).where(eq(qualityFindings.draftId, draftId));
  assert.ok(findings.some((f) => f.kind === "unsupported" && f.bulletId === invented.id));
  assert.ok(findings.some((f) => f.kind === "note" && f.source === "claude"));
});

test("generate (fake Claude) → edit → approve → duplicate", async () => {
  const draftId = await generateDraft(db, TEST_USER, jobId, { useClaude: true });
  const editor = await loadDraftEditor(db, TEST_USER, draftId);
  assert.ok(editor && editor.bullets.length >= 2);
  assert.equal(editor.draft.name, "Customer Success Manager at Acme — v2");

  await assert.rejects(approveDraft(db, TEST_USER, draftId), /still need accepting/);
  for (const b of editor.bullets) await setBulletState(db, TEST_USER, b.id, "accepted");
  const target = editor.bullets[0];
  await updateBulletText(db, TEST_USER, target.id, `${target.text} Extra 42 things.`);
  await assert.rejects(approveDraft(db, TEST_USER, draftId), /error/);
  const [metricFinding] = await db.select().from(qualityFindings).where(and(eq(qualityFindings.draftId, draftId), eq(qualityFindings.kind, "invented_metric")));
  await setFindingResolved(db, TEST_USER, metricFinding.id, true);
  await approveDraft(db, TEST_USER, draftId);
  const [approved] = await db.select().from(resumeDrafts).where(eq(resumeDrafts.id, draftId));
  assert.equal(approved.status, "approved");

  // Editing sends it back to draft; the dismissal survives the re-check.
  await updateBulletText(db, TEST_USER, target.id, `${target.text} Extra 42 things!`);
  const [reopened] = await db.select().from(resumeDrafts).where(eq(resumeDrafts.id, draftId));
  assert.equal(reopened.status, "draft");

  const copyId = await duplicateDraft(db, TEST_USER, draftId);
  const copy = await loadDraftEditor(db, TEST_USER, copyId);
  assert.equal(copy?.draft.parentId, draftId);
  assert.equal(copy?.bullets.length, editor.bullets.length);
  const list = await listDraftsForJob(db, TEST_USER, jobId);
  assert.ok(list.length >= 3);
});

test("regenerate respects locks; review stores Claude findings; add bullet from achievement", async () => {
  const draftId = await generateDraft(db, TEST_USER, jobId, { useClaude: false });
  const editor = (await loadDraftEditor(db, TEST_USER, draftId))!;
  const target = editor.bullets.find((b) => b.achievementId === achA)!;
  await setBulletState(db, TEST_USER, target.id, "locked");
  await assert.rejects(regenerateBullet(db, TEST_USER, target.id, { tone: "plain", length: "shorter", emphasis: "outcome" }), /locked/);
  await setBulletState(db, TEST_USER, target.id, "accepted");
  await regenerateBullet(db, TEST_USER, target.id, { tone: "plain", length: "shorter", emphasis: "outcome" });
  const [after] = await db.select().from(resumeBullets).where(eq(resumeBullets.id, target.id));
  assert.equal(after.state, "proposed");
  assert.equal(after.originalText, target.originalText);

  await reviewDraft(db, TEST_USER, draftId);
  await addBulletFromAchievement(db, TEST_USER, draftId, achB);
  const bullets = await db.select().from(resumeBullets).where(eq(resumeBullets.draftId, draftId));
  assert.ok(bullets.some((b) => b.achievementId === achB && b.roleId === roleB && b.state === "accepted"));
});

test("resume document and text export exclude rejected bullets and keep role order", async () => {
  const draftId = await generateDraft(db, TEST_USER, jobId, { useClaude: false });
  const editor = (await loadDraftEditor(db, TEST_USER, draftId))!;
  await setBulletState(db, TEST_USER, editor.bullets[0].id, "rejected");
  const doc = (await loadResumeDocument(db, TEST_USER, draftId))!;
  assert.deepEqual(doc.experience.map((r) => r.title), ["Head Coach", "Trainer"]);
  assert.equal(doc.experience[0].dates, "Mar 2019 – Present");
  const text = renderResumeText(doc);
  assert.doesNotMatch(text, new RegExp(editor.bullets[0].text.slice(0, 20)));
  assert.match(text, /EXPERIENCE/);
});

test("drafts are scoped to their owner", async () => {
  await assert.rejects(generateDraft(db, "someone-else", jobId, { useClaude: false }), /Job not found/);
  const [draft] = await db.select().from(resumeDrafts).limit(1);
  assert.equal(await loadDraftEditor(db, "someone-else", draft.id), null);
});
