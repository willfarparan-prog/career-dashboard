import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import type { Database } from "@/db";
import { achievements, applications, coverLetters, jobs, profiles, qualityFindings, resumeBullets, resumeDrafts, roles, snapshots } from "@/db/schema";
import { markApplied } from "@/lib/applications/mark-applied";
import { ensureApplicationForJob, getApplication, getApplicationForJob, groupByStatus, listApplications, loadApplyOptions } from "@/lib/applications/queries";
import { updateApplication } from "@/lib/applications/update";
import { renderCoverLetterText } from "@/lib/export/cover-letter";
import { snapshotHash } from "@/lib/snapshots/create";
import type { SnapshotContent } from "@/lib/snapshots/types";
import { TEST_USER, testDatabase } from "./helpers";

let db: Database;
let close: () => Promise<void>;
before(async () => ({ db, close } = await testDatabase()));
after(async () => close());

const OTHER_USER = "someone-else";

/** A job with an application, a resume draft (two bullets), and a cover letter. */
async function seed(userId = TEST_USER, options: { approved?: boolean; openError?: boolean } = {}) {
  await db
    .insert(profiles)
    .values({ userId, fullName: "Test Person", headline: "Customer Success", email: "test@example.com", phone: "555-0100", location: "Denver, CO", links: ["linkedin.com/in/test"] })
    .onConflictDoNothing();
  const [role] = await db.insert(roles).values({ userId, employer: "Gym Co", title: "Head Coach", start: "2020-01", isCurrent: true, factStatus: "verified" }).returning();
  const [achievement] = await db.insert(achievements).values({ userId, roleId: role.id, headline: "Built onboarding", factStatus: "verified" }).returning();
  const [job] = await db
    .insert(jobs)
    .values({ userId, company: "Acme", title: "CSM", location: "Remote", compText: "$90k", sourceUrl: "https://acme.example/jobs/1", requisitionId: "R-1", postingText: "We need a CSM." })
    .returning();
  const [application] = await db.insert(applications).values({ userId, jobId: job.id }).returning();
  const [draft] = await db
    .insert(resumeDrafts)
    .values({
      userId,
      jobId: job.id,
      name: "Acme v1",
      status: options.approved ? "approved" : "draft",
      summary: "Coach turned CSM.",
      skills: [{ name: "Onboarding", evidence: [] }],
      roleOrder: [role.id],
      model: "claude-opus-5-5",
      promptVersion: "draft@1",
    })
    .returning();
  const [kept] = await db
    .insert(resumeBullets)
    .values({ userId, draftId: draft.id, roleId: role.id, achievementId: achievement.id, text: "Built an onboarding program.", originalText: "Built an onboarding program.", state: "accepted", position: 0 })
    .returning();
  await db.insert(resumeBullets).values({ userId, draftId: draft.id, roleId: role.id, text: "Rejected line.", originalText: "Rejected line.", state: "rejected", position: 1 });
  if (options.openError) {
    await db.insert(qualityFindings).values({ userId, draftId: draft.id, bulletId: kept.id, kind: "unsupported", severity: "error", message: "No evidence", source: "rule" });
    await db.insert(qualityFindings).values({ userId, draftId: draft.id, kind: "style", severity: "error", message: "Fixed already", source: "rule", resolved: true });
  }
  const [letter] = await db
    .insert(coverLetters)
    .values({
      userId,
      jobId: job.id,
      draftId: draft.id,
      status: "approved",
      paragraphs: [{ text: "Dear Acme team,", evidence: [] }, { text: "I built onboarding.", evidence: [achievement.id] }],
      model: "claude-opus-5-5",
      promptVersion: "cover@1",
    })
    .returning();
  return { role, achievement, job, application, draft, kept, letter };
}

const snapshotRow = async (id: string | null) => {
  assert.ok(id, "expected a snapshot id");
  const [row] = await db.select().from(snapshots).where(eq(snapshots.id, id));
  assert.ok(row, "snapshot row missing");
  return row;
};

test("markApplied freezes posting, resume and cover letter with correct content and hashes", async () => {
  const { job, application, draft, letter } = await seed(TEST_USER, { approved: true });
  const submittedAt = new Date("2026-09-20T12:00:00Z");
  const result = await markApplied(db, TEST_USER, application.id, { resumeDraftId: draft.id, coverLetterId: letter.id, submittedAt, source: "Company site" });
  assert.ok(result.ok, result.ok ? "" : result.error);
  assert.deepEqual(result.warnings, []);

  const [updated] = await db.select().from(applications).where(eq(applications.id, application.id));
  assert.equal(updated.status, "applied");
  assert.equal(updated.submittedAt?.toISOString(), submittedAt.toISOString());
  assert.equal(updated.source, "Company site");

  const posting = await snapshotRow(updated.postingSnapshotId);
  assert.equal(posting.kind, "posting");
  assert.equal(posting.jobId, job.id);
  assert.equal(posting.sourceId, job.id);
  const postingContent = posting.content as SnapshotContent;
  assert.equal(postingContent.kind, "posting");
  assert.deepEqual(postingContent.document, {
    company: "Acme",
    title: "CSM",
    location: "Remote",
    compText: "$90k",
    sourceUrl: "https://acme.example/jobs/1",
    requisitionId: "R-1",
    capturedAt: job.capturedAt.toISOString(),
    postingText: "We need a CSM.",
  });
  assert.match(posting.renderedText, /^CSM — Acme\n/);
  assert.match(posting.renderedText, /We need a CSM\./);

  const resume = await snapshotRow(updated.resumeSnapshotId);
  assert.equal(resume.kind, "resume");
  assert.equal(resume.sourceId, draft.id);
  assert.equal(resume.model, "claude-opus-5-5");
  assert.equal(resume.promptVersion, "draft@1");
  const resumeContent = resume.content as SnapshotContent;
  assert.ok(resumeContent.kind === "resume");
  assert.equal(resumeContent.document.draftId, draft.id);
  assert.equal(resumeContent.document.person.fullName, "Test Person");
  assert.deepEqual(resumeContent.document.experience[0].bullets, ["Built an onboarding program."]);
  assert.match(resume.renderedText, /^TEST PERSON\n/);
  assert.match(resume.renderedText, /- Built an onboarding program\./);
  assert.doesNotMatch(resume.renderedText, /Rejected line/);

  const cover = await snapshotRow(updated.coverLetterSnapshotId);
  assert.equal(cover.kind, "cover_letter");
  assert.equal(cover.sourceId, letter.id);
  assert.equal(cover.promptVersion, "cover@1");
  const coverContent = cover.content as SnapshotContent;
  assert.ok(coverContent.kind === "cover_letter");
  assert.deepEqual(coverContent.document, {
    person: { fullName: "Test Person", headline: "Customer Success", email: "test@example.com", phone: "555-0100", location: "Denver, CO", links: ["linkedin.com/in/test"] },
    company: "Acme",
    jobTitle: "CSM",
    paragraphs: ["Dear Acme team,", "I built onboarding."],
  });
  // Stored text is the same plain-text letter the TXT export produces (greeting kept, sign-off added).
  assert.equal(cover.renderedText, renderCoverLetterText((cover.content as Extract<SnapshotContent, { kind: "cover_letter" }>).document, { date: cover.createdAt }));
  assert.match(cover.renderedText, /Dear Acme team,\n\nI built onboarding\.\n\nSincerely,\nTest Person\n$/);

  // Hashes are sha256 over text + canonical content, and can be recomputed from the stored row.
  for (const snap of [posting, resume, cover]) {
    assert.match(snap.contentHash, /^[0-9a-f]{64}$/);
    assert.equal(snap.contentHash, snapshotHash(snap.renderedText, snap.content));
  }
  assert.equal(new Set([posting.contentHash, resume.contentHash, cover.contentHash]).size, 3);

  const detail = await getApplication(db, TEST_USER, application.id);
  assert.equal(detail?.sent.resume?.id, resume.id);
  assert.equal(detail?.sent.coverLetter?.id, cover.id);
  assert.equal(detail?.sent.posting?.id, posting.id);
});

test("markApplied refuses to re-freeze, but the status can still change", async () => {
  const { application, draft } = await seed();
  const first = await markApplied(db, TEST_USER, application.id, { resumeDraftId: draft.id });
  assert.ok(first.ok);
  assert.equal(first.snapshots.coverLetter, null);
  const before = await db.select().from(snapshots).where(eq(snapshots.jobId, application.jobId));
  assert.equal(before.length, 2);

  const second = await markApplied(db, TEST_USER, application.id, { resumeDraftId: draft.id });
  assert.equal(second.ok, false);
  assert.match(second.ok ? "" : second.error, /already marked as applied/);
  assert.equal((await db.select().from(snapshots).where(eq(snapshots.jobId, application.jobId))).length, 2);

  const moved = await updateApplication(db, TEST_USER, application.id, { status: "interview" });
  assert.ok(moved.ok);
  assert.equal(moved.application.status, "interview");
  assert.equal(moved.application.resumeSnapshotId, first.snapshots.resume.id);
  // Back to "applied" is fine once the files are frozen.
  assert.ok((await updateApplication(db, TEST_USER, application.id, { status: "applied" })).ok);
  assert.equal((await markApplied(db, TEST_USER, application.id, { resumeDraftId: draft.id })).ok, false);
});

test("snapshots stay unchanged after the draft and cover letter are edited", async () => {
  const { application, draft, kept, letter, job } = await seed();
  const result = await markApplied(db, TEST_USER, application.id, { resumeDraftId: draft.id, coverLetterId: letter.id });
  assert.ok(result.ok);
  const frozen = await db.select().from(snapshots).where(eq(snapshots.jobId, job.id));

  await db.update(resumeDrafts).set({ summary: "Totally different summary.", name: "Renamed" }).where(eq(resumeDrafts.id, draft.id));
  await db.update(resumeBullets).set({ text: "Edited after sending." }).where(eq(resumeBullets.id, kept.id));
  await db.update(coverLetters).set({ paragraphs: [{ text: "New letter.", evidence: [] }] }).where(eq(coverLetters.id, letter.id));
  await db.update(jobs).set({ postingText: "Posting changed later." }).where(eq(jobs.id, job.id));

  const after = await db.select().from(snapshots).where(eq(snapshots.jobId, job.id));
  assert.deepEqual(after, frozen);
  const resume = after.find((row) => row.kind === "resume")!;
  assert.match(resume.renderedText, /Coach turned CSM\./);
  assert.match(resume.renderedText, /Built an onboarding program\./);
  assert.doesNotMatch(resume.renderedText, /Edited after sending|Totally different/);
  assert.match(after.find((row) => row.kind === "posting")!.renderedText, /We need a CSM\./);
  assert.match(after.find((row) => row.kind === "cover_letter")!.renderedText, /I built onboarding\./);
});

test("markApplied checks ownership of the application, draft and cover letter", async () => {
  const mine = await seed();
  const theirs = await seed(OTHER_USER);
  const deny = async (userId: string, applicationId: string, input: Parameters<typeof markApplied>[3], pattern: RegExp) => {
    const result = await markApplied(db, userId, applicationId, input);
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, pattern);
  };
  await deny(TEST_USER, theirs.application.id, { resumeDraftId: theirs.draft.id }, /Application not found/);
  await deny(TEST_USER, mine.application.id, { resumeDraftId: theirs.draft.id }, /Resume draft not found/);
  await deny(TEST_USER, mine.application.id, { resumeDraftId: mine.draft.id, coverLetterId: theirs.letter.id }, /Cover letter not found/);
  await deny(TEST_USER, "not-a-uuid", { resumeDraftId: mine.draft.id }, /Application not found/);
  await deny(TEST_USER, mine.application.id, { resumeDraftId: "nope" }, /Choose the resume/);

  // A draft or cover letter from another of my own jobs is refused too.
  const other = await seed();
  await deny(TEST_USER, mine.application.id, { resumeDraftId: other.draft.id }, /different job/);
  await deny(TEST_USER, mine.application.id, { resumeDraftId: mine.draft.id, coverLetterId: other.letter.id }, /different job/);

  // Nothing was written by any refused attempt.
  assert.equal((await db.select().from(snapshots).where(eq(snapshots.jobId, mine.job.id))).length, 0);
  const [app] = await db.select().from(applications).where(eq(applications.id, mine.application.id));
  assert.equal(app.status, "saved");
  assert.equal(app.resumeSnapshotId, null);

  // Updates are owner-scoped as well.
  assert.equal((await updateApplication(db, TEST_USER, theirs.application.id, { notes: "hi" })).ok, false);
  assert.equal(await getApplication(db, TEST_USER, theirs.application.id), null);
  assert.equal(await getApplicationForJob(db, TEST_USER, theirs.job.id), null);
  assert.equal(await ensureApplicationForJob(db, TEST_USER, theirs.job.id), null);
});

test("markApplied warns about unapproved drafts and unresolved errors but still records", async () => {
  const { application, draft } = await seed(TEST_USER, { approved: false, openError: true });
  await db.insert(resumeBullets).values({ userId: TEST_USER, draftId: draft.id, text: "Still proposed.", originalText: "Still proposed.", state: "proposed", position: 2 });
  const result = await markApplied(db, TEST_USER, application.id, { resumeDraftId: draft.id });
  assert.ok(result.ok);
  assert.equal(result.warnings.length, 3);
  assert.match(result.warnings.join(" "), /wasn't approved/);
  assert.match(result.warnings.join(" "), /1 unresolved error\b/);
  assert.match(result.warnings.join(" "), /1 bullet was still proposed/);
  assert.equal(result.application.status, "applied");
});

test("markApplied refuses empty cover letters and future dates", async () => {
  const { application, draft, job } = await seed();
  const [empty] = await db.insert(coverLetters).values({ userId: TEST_USER, jobId: job.id, paragraphs: [{ text: "  ", evidence: [] }] }).returning();
  const noLetter = await markApplied(db, TEST_USER, application.id, { resumeDraftId: draft.id, coverLetterId: empty.id });
  assert.equal(noLetter.ok, false);
  const future = await markApplied(db, TEST_USER, application.id, { resumeDraftId: draft.id, submittedAt: new Date(Date.now() + 5 * 86_400_000) });
  assert.equal(future.ok, false);
  assert.equal((await db.select().from(snapshots).where(eq(snapshots.jobId, job.id))).length, 0);
});

test("status, next action, contact, source and notes update with validation", async () => {
  const { application } = await seed();
  const denied = await updateApplication(db, TEST_USER, application.id, { status: "applied" });
  assert.equal(denied.ok, false);
  assert.match(denied.ok ? "" : denied.error, /Mark as applied/);

  const result = await updateApplication(db, TEST_USER, application.id, {
    status: "ready",
    nextAction: "  Follow up with recruiter ",
    nextActionDate: "2026-10-02",
    contactName: "Pat",
    contactEmail: "pat@acme.example",
    contactNote: "Met at meetup",
    source: "Referral",
    notes: "Strong fit",
  });
  assert.ok(result.ok);
  assert.equal(result.application.status, "ready");
  assert.equal(result.application.nextAction, "Follow up with recruiter");
  assert.equal(result.application.nextActionDate, "2026-10-02");
  assert.equal(result.application.contactEmail, "pat@acme.example");

  assert.equal((await updateApplication(db, TEST_USER, application.id, { contactEmail: "not an email" })).ok, false);
  assert.equal((await updateApplication(db, TEST_USER, application.id, { nextActionDate: "someday" })).ok, false);
  assert.equal((await updateApplication(db, TEST_USER, application.id, { status: "bogus" as never })).ok, false);
  const cleared = await updateApplication(db, TEST_USER, application.id, { nextActionDate: "" });
  assert.ok(cleared.ok);
  assert.equal(cleared.application.nextActionDate, "");
});

test("lists group by status, apply options label drafts, and ensure creates a missing row", async () => {
  const { job, draft, letter } = await seed(TEST_USER, { openError: true });
  const options = await loadApplyOptions(db, TEST_USER, job.id);
  assert.deepEqual(
    options.drafts.map((d) => ({ id: d.id, approved: d.approved, openErrors: d.openErrors })),
    [{ id: draft.id, approved: false, openErrors: 1 }],
  );
  assert.deepEqual(options.coverLetters.map((c) => c.id), [letter.id]);

  const items = await listApplications(db, TEST_USER);
  assert.ok(items.length > 0);
  assert.ok(items.every((item) => item.userId === TEST_USER && item.job.id === item.jobId));
  const groups = groupByStatus(items);
  assert.equal(Object.keys(groups).length, 8);
  assert.ok(groups.saved.some((item) => item.jobId === job.id));

  const [bare] = await db.insert(jobs).values({ userId: TEST_USER, company: "NoApp", postingText: "x" }).returning();
  const created = await ensureApplicationForJob(db, TEST_USER, bare.id);
  assert.equal(created?.status, "saved");
  const again = await ensureApplicationForJob(db, TEST_USER, bare.id);
  assert.equal(again?.id, created?.id);
});
