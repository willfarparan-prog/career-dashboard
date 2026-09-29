import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/db";
import { achievements, aiRuns, coverLetters, jobRequirements, jobs, profiles, resumeDrafts, roles } from "@/db/schema";
import { coverLetterContent, draftCoverLetter, fakeCoverLetter, loadCoverInputs, normalizeTone, PROMPT_VERSION, resolveParagraphs } from "@/lib/ai/tasks/cover";
import { coverLetterDocument, loadCoverLetterDocument } from "@/lib/cover/document";
import {
  CoverLetterError,
  countWords,
  createCoverLetter,
  deleteCoverLetter,
  getCoverLetter,
  latestCoverLetter,
  listCoverLetters,
  loadEvidence,
  setCoverLetterStatus,
  updateCoverLetterParagraphs,
} from "@/lib/cover/letters";
import { renderCoverLetterText } from "@/lib/export/cover-letter";
import { TEST_USER, testDatabase } from "./helpers";

const OTHER_USER = "someone-else";

let db: Database;
let close: () => Promise<void>;
let jobId: string;
let otherJobId: string;
let approvedDraftId: string;
let plainDraftId: string;
let otherDraftId: string;
let onboardingId: string;
let stakeholdersId: string;
let privateId: string;

before(async () => {
  ({ db, close } = await testDatabase());
  await db.insert(profiles).values({
    userId: TEST_USER,
    fullName: "Jordan Rivera",
    headline: "Coach moving into customer success",
    email: "jordan@example.com",
    phone: "512-555-0100",
    location: "Austin, TX",
    links: ["linkedin.com/in/jordanrivera"],
  });
  const [role] = await db
    .insert(roles)
    .values({ userId: TEST_USER, employer: "Diamond Edge", title: "Head Coach", start: "2021-04", isCurrent: true, factStatus: "verified" })
    .returning();
  [{ id: onboardingId }] = await db
    .insert(achievements)
    .values({ userId: TEST_USER, roleId: role.id, headline: "Built a 12-week onboarding program for 40 families", outcome: "Drop-off fell by about 30%", factStatus: "verified", sort: 1 })
    .returning();
  [{ id: stakeholdersId }] = await db
    .insert(achievements)
    .values({ userId: TEST_USER, roleId: role.id, headline: "Ran weekly check-ins with parents and staff", factStatus: "verified", sort: 2 })
    .returning();
  [{ id: privateId }] = await db
    .insert(achievements)
    .values({ userId: TEST_USER, roleId: role.id, headline: "Private negotiation story", factStatus: "private", sort: 3 })
    .returning();

  const [job] = await db
    .insert(jobs)
    .values({
      userId: TEST_USER,
      company: "Acme Health",
      title: "Customer Success Manager",
      location: "Remote",
      remoteType: "remote",
      postingText: "Acme Health helps clinics onboard patients. You will own onboarding for new clinic customers.",
      analysis: { summary: "Own onboarding and adoption for mid-size clinics.", responsibilities: ["Run onboarding", "Drive adoption"], tools: ["Salesforce"], screeningQuestions: [], seniority: "mid" },
      matchedAt: new Date(),
    })
    .returning();
  jobId = job.id;
  await db.insert(jobRequirements).values([
    { userId: TEST_USER, jobId, kind: "must", text: "Experience onboarding customers", label: "strong", achievementIds: [onboardingId], position: 0 },
    { userId: TEST_USER, jobId, kind: "preferred", text: "Manage stakeholder relationships", label: "transferable", achievementIds: [stakeholdersId, privateId], translation: "Parent and staff check-ins map to account check-ins", position: 1 },
    { userId: TEST_USER, jobId, kind: "tool", text: "Salesforce", label: "gap", achievementIds: [], position: 2 },
  ]);
  [{ id: approvedDraftId }] = await db
    .insert(resumeDrafts)
    .values({ userId: TEST_USER, jobId, name: "Acme CSM", status: "approved", approvedAt: new Date(), summary: "Coach turned onboarding lead who gets people to value fast." })
    .returning();
  [{ id: plainDraftId }] = await db.insert(resumeDrafts).values({ userId: TEST_USER, jobId, name: "Acme CSM (short)", summary: "Short summary." }).returning();

  const [otherJob] = await db.insert(jobs).values({ userId: OTHER_USER, company: "Elsewhere", title: "CSM", postingText: "x" }).returning();
  otherJobId = otherJob.id;
  [{ id: otherDraftId }] = await db.insert(resumeDrafts).values({ userId: OTHER_USER, jobId: otherJobId, name: "Theirs" }).returning();
});
after(async () => close());

test("generate stores paragraphs with resolved evidence ids and drops invented aliases", async () => {
  const letter = await draftCoverLetter(db, TEST_USER, jobId, { tone: "direct" });
  assert.equal(letter.status, "draft");
  assert.equal(letter.promptVersion, PROMPT_VERSION);
  assert.equal(PROMPT_VERSION, "cover@1");
  assert.match(letter.model, /^fake:/);
  assert.equal(letter.draftId, approvedDraftId, "defaults to the job's approved resume draft");
  assert.ok(letter.paragraphs.length >= 3 && letter.paragraphs.length <= 4);

  // The fake cites A1 plus an invented A999 in paragraph 2: only A1 survives.
  assert.deepEqual(letter.paragraphs[1].evidence, [onboardingId]);
  // Lower-case aliases still resolve.
  assert.deepEqual(letter.paragraphs[2].evidence, [stakeholdersId]);
  const cited = letter.paragraphs.flatMap((paragraph) => paragraph.evidence);
  assert.ok(cited.every((id) => id === onboardingId || id === stakeholdersId));
  assert.ok(!cited.includes(privateId), "private achievements are never cited");
  assert.match(letter.paragraphs[0].text, /Customer Success Manager role at Acme Health/);

  const [run] = await db.select().from(aiRuns).where(and(eq(aiRuns.task, "cover"), eq(aiRuns.refId, jobId)));
  assert.equal(run.status, "ok");
  assert.equal(run.promptVersion, "cover@1");
});

test("the prompt carries the job, labeled requirements with matched aliases, and the resume summary", async () => {
  const inputs = await loadCoverInputs(db, TEST_USER, jobId);
  const content = coverLetterContent(inputs, "formal");
  assert.match(content, /Company: Acme Health/);
  assert.match(content, /Title: Customer Success Manager/);
  assert.match(content, /Summary: Own onboarding and adoption/);
  assert.match(content, /\[must\] Experience onboarding customers → strong evidence · achievements: A1/);
  // The private achievement has no alias, so only A2 is listed.
  assert.match(content, /\[preferred\] Manage stakeholder relationships → transferable · achievements: A2 · framing: Parent and staff/);
  assert.match(content, /\[tool\] Salesforce → gap/);
  assert.match(content, /Coach turned onboarding lead/);
  assert.match(content, /polished and reserved/);
  assert.doesNotMatch(inputs.context.text, /Private negotiation story/);
  assert.equal(normalizeTone("DIRECT"), "direct");
  assert.equal(normalizeTone("snarky"), "warm");
});

test("the base resume draft can be chosen, skipped, but never borrowed from another user", async () => {
  const chosen = await draftCoverLetter(db, TEST_USER, jobId, { draftId: plainDraftId });
  assert.equal(chosen.draftId, plainDraftId);
  const none = await draftCoverLetter(db, TEST_USER, jobId, { draftId: null });
  assert.equal(none.draftId, null);
  await assert.rejects(draftCoverLetter(db, TEST_USER, jobId, { draftId: otherDraftId }), CoverLetterError);
  await assert.rejects(draftCoverLetter(db, TEST_USER, otherJobId), CoverLetterError);
  await assert.rejects(draftCoverLetter(db, OTHER_USER, jobId), CoverLetterError);
});

test("resolveParagraphs keeps only real aliases and non-empty text", async () => {
  const inputs = await loadCoverInputs(db, TEST_USER, jobId, null);
  const stored = resolveParagraphs(
    { paragraphs: [{ text: "  One.  ", evidence: ["A1", "a1", "A42", "R1"] }, { text: "   ", evidence: ["A2"] }, { text: "Two.", evidence: [] }] },
    inputs.context,
  );
  assert.deepEqual(stored, [
    { text: "One.", evidence: [onboardingId] },
    { text: "Two.", evidence: [] },
  ]);
  // The fake is deterministic.
  assert.deepEqual(fakeCoverLetter(inputs, "warm"), fakeCoverLetter(inputs, "warm"));
});

test("editing keeps each paragraph's evidence; approval is exclusive and tied to the exact text", async () => {
  const first = await createCoverLetter(db, TEST_USER, {
    jobId,
    paragraphs: [
      { text: "Opening.", evidence: [] },
      { text: "Story one.", evidence: [onboardingId, onboardingId] },
      { text: "Story two.", evidence: [stakeholdersId] },
    ],
  });
  assert.deepEqual(first.paragraphs[1].evidence, [onboardingId], "evidence is de-duplicated");

  const edited = await updateCoverLetterParagraphs(db, TEST_USER, first.id, ["Opening, rewritten.", "Story one, tightened.", ""]);
  assert.ok(edited);
  assert.deepEqual(edited.paragraphs, [
    { text: "Opening, rewritten.", evidence: [] },
    { text: "Story one, tightened.", evidence: [onboardingId] },
  ]);
  await assert.rejects(updateCoverLetterParagraphs(db, TEST_USER, first.id, ["", "  "]), CoverLetterError);

  const approved = await setCoverLetterStatus(db, TEST_USER, first.id, "approved");
  assert.equal(approved?.status, "approved");
  const same = await updateCoverLetterParagraphs(db, TEST_USER, first.id, ["Opening, rewritten.", "Story one, tightened."]);
  assert.equal(same?.status, "approved", "saving unchanged text keeps the approval");
  const changed = await updateCoverLetterParagraphs(db, TEST_USER, first.id, ["Opening, rewritten again.", "Story one, tightened."]);
  assert.equal(changed?.status, "draft", "changing approved text moves it back to draft");

  await setCoverLetterStatus(db, TEST_USER, first.id, "approved");
  const second = await createCoverLetter(db, TEST_USER, { jobId, paragraphs: [{ text: "Another version.", evidence: [] }] });
  await setCoverLetterStatus(db, TEST_USER, second.id, "approved");
  assert.equal((await getCoverLetter(db, TEST_USER, first.id))?.status, "draft", "approving one letter un-approves the other");
  assert.equal((await setCoverLetterStatus(db, TEST_USER, second.id, "draft"))?.status, "draft");

  assert.equal((await latestCoverLetter(db, TEST_USER, jobId))?.id, second.id);
  const evidence = await loadEvidence(db, TEST_USER, [first]);
  assert.equal(evidence.get(onboardingId)?.headline, "Built a 12-week onboarding program for 40 families");

  assert.equal((await deleteCoverLetter(db, TEST_USER, second.id))?.id, second.id);
  assert.equal(await getCoverLetter(db, TEST_USER, second.id), null);
});

test("every operation is scoped to the owner", async () => {
  const mine = await createCoverLetter(db, TEST_USER, { jobId, paragraphs: [{ text: "Mine.", evidence: [onboardingId] }] });
  assert.equal(await getCoverLetter(db, OTHER_USER, mine.id), null);
  assert.equal(await updateCoverLetterParagraphs(db, OTHER_USER, mine.id, ["Hijacked."]), null);
  assert.equal(await setCoverLetterStatus(db, OTHER_USER, mine.id, "approved"), null);
  assert.equal(await deleteCoverLetter(db, OTHER_USER, mine.id), null);
  assert.equal(await loadCoverLetterDocument(db, OTHER_USER, mine.id), null);
  assert.deepEqual(await listCoverLetters(db, OTHER_USER, jobId), []);
  assert.equal((await loadEvidence(db, OTHER_USER, [mine])).size, 0);
  await assert.rejects(createCoverLetter(db, OTHER_USER, { jobId, paragraphs: [{ text: "x", evidence: [] }] }), CoverLetterError);
  await assert.rejects(createCoverLetter(db, TEST_USER, { jobId, draftId: otherDraftId, paragraphs: [{ text: "x", evidence: [] }] }), CoverLetterError);

  const [row] = await db.select().from(coverLetters).where(eq(coverLetters.id, mine.id));
  assert.equal(row.paragraphs[0].text, "Mine.");
  assert.equal(row.status, "draft");
});

test("the CoverLetterDocument comes from the profile, the job and the letter's paragraphs", async () => {
  const letter = await createCoverLetter(db, TEST_USER, {
    jobId,
    paragraphs: [
      { text: "First paragraph here.", evidence: [] },
      { text: "Second paragraph here.", evidence: [onboardingId] },
    ],
  });
  const loaded = await loadCoverLetterDocument(db, TEST_USER, letter.id);
  assert.ok(loaded);
  assert.deepEqual(loaded.document, {
    person: {
      fullName: "Jordan Rivera",
      headline: "Coach moving into customer success",
      email: "jordan@example.com",
      phone: "512-555-0100",
      location: "Austin, TX",
      links: ["linkedin.com/in/jordanrivera"],
    },
    company: "Acme Health",
    jobTitle: "Customer Success Manager",
    paragraphs: ["First paragraph here.", "Second paragraph here."],
  });
  const text = renderCoverLetterText(loaded.document, { date: new Date("2026-09-29T12:00:00Z") });
  assert.match(text, /^Jordan Rivera\n/);
  assert.match(text, /Dear Hiring Team,\n\nFirst paragraph here\.\n\nSecond paragraph here\.\n\nSincerely,\nJordan Rivera\n$/);

  const blank = coverLetterDocument(null, { company: "", title: "" }, [{ text: "  ", evidence: [] }]);
  assert.equal(blank.person.fullName, "");
  assert.deepEqual(blank.paragraphs, []);
});

test("word counts", () => {
  assert.equal(countWords([]), 0);
  assert.equal(countWords(["One two  three", { text: " four\nfive ", evidence: [] }, "  "]), 5);
});
