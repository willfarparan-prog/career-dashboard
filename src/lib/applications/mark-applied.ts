import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@/db";
import { applications, coverLetters, jobs, profiles, resumeDrafts } from "@/db/schema";
import { loadResumeDocument, renderResumeText } from "@/lib/resume/document";
import { coverLetterDocument } from "@/lib/cover/document";
import { renderCoverLetterText } from "@/lib/export/cover-letter";
import { renderPostingText } from "@/lib/export/posting";
import { createSnapshot, type Snapshot } from "@/lib/snapshots/create";
import type { PostingSnapshot } from "@/lib/snapshots/types";
import { isFrozen, isUuid, type Application } from "./queries";
import { draftReadiness } from "./readiness";

export type MarkAppliedInput = {
  resumeDraftId: string;
  coverLetterId?: string | null;
  /** Defaults to now. */
  submittedAt?: Date;
  /** Where it was submitted (company site, LinkedIn, referral…). Blank keeps the current value. */
  source?: string;
};

export type MarkAppliedResult =
  | {
      ok: true;
      application: Application;
      snapshots: { posting: Snapshot; resume: Snapshot; coverLetter: Snapshot | null };
      /** Allowed, but worth knowing: the draft wasn't approved, still has errors, etc. */
      warnings: string[];
    }
  | { ok: false; error: string };

const fail = (error: string): MarkAppliedResult => ({ ok: false, error });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Records a submission and freezes exactly what was sent: the posting as it
 * read, the resume draft rendered as a document, and the cover letter if one
 * was used. Snapshots are insert-only, so once an application is marked
 * applied its files are final; the status can still change afterwards.
 */
export async function markApplied(db: Database, userId: string, applicationId: string, input: MarkAppliedInput): Promise<MarkAppliedResult> {
  if (!isUuid(applicationId)) return fail("Application not found.");
  const [application] = await db.select().from(applications).where(and(eq(applications.id, applicationId), eq(applications.userId, userId)));
  if (!application) return fail("Application not found.");
  if (isFrozen(application)) return fail("This application is already marked as applied. The files you sent are saved and can't be replaced.");

  const [job] = await db.select().from(jobs).where(and(eq(jobs.id, application.jobId), eq(jobs.userId, userId)));
  if (!job) return fail("Job not found.");

  if (!isUuid(input.resumeDraftId)) return fail("Choose the resume you sent.");
  const [draft] = await db.select().from(resumeDrafts).where(and(eq(resumeDrafts.id, input.resumeDraftId), eq(resumeDrafts.userId, userId)));
  if (!draft) return fail("Resume draft not found.");
  if (draft.jobId && draft.jobId !== job.id) return fail("That resume draft belongs to a different job.");

  let letter: typeof coverLetters.$inferSelect | null = null;
  if (input.coverLetterId) {
    if (!isUuid(input.coverLetterId)) return fail("Cover letter not found.");
    [letter] = await db.select().from(coverLetters).where(and(eq(coverLetters.id, input.coverLetterId), eq(coverLetters.userId, userId)));
    if (!letter) return fail("Cover letter not found.");
    if (letter.jobId !== job.id) return fail("That cover letter belongs to a different job.");
  }
  const paragraphs = letter ? letter.paragraphs.map((p) => p.text.trim()).filter(Boolean) : [];
  if (letter && !paragraphs.length) return fail("That cover letter is empty. Choose another or send without one.");

  const now = new Date();
  const submittedAt = input.submittedAt && !Number.isNaN(input.submittedAt.getTime()) ? input.submittedAt : now;
  if (submittedAt.getTime() > now.getTime() + 36 * 3_600_000) return fail("The submitted date can't be in the future.");

  const resumeDoc = await loadResumeDocument(db, userId, draft.id);
  if (!resumeDoc) return fail("Resume draft not found.");
  if (!resumeDoc.experience.some((role) => role.bullets.length) && !resumeDoc.summary) return fail("That resume draft is empty.");

  const warnings: string[] = [];
  if (draft.status !== "approved") warnings.push("The resume draft wasn't approved yet.");
  const readiness = (await draftReadiness(db, userId, [draft.id])).get(draft.id);
  if (readiness?.openErrors) warnings.push(`The resume draft had ${plural(readiness.openErrors, "unresolved error", "unresolved errors")} from the quality check.`);
  if (readiness?.proposedBullets) warnings.push(`${plural(readiness.proposedBullets, "bullet was", "bullets were")} still proposed, not reviewed.`);
  if (letter && letter.status !== "approved") warnings.push("The cover letter wasn't approved yet.");

  const posting: PostingSnapshot = {
    company: job.company,
    title: job.title,
    location: job.location,
    compText: job.compText,
    sourceUrl: job.sourceUrl,
    requisitionId: job.requisitionId,
    capturedAt: job.capturedAt.toISOString(),
    postingText: job.postingText,
  };

  // Insert-only from here. Snapshots are built fully before anything is written.
  const postingSnapshot = await createSnapshot(db, {
    userId,
    kind: "posting",
    jobId: job.id,
    sourceId: job.id,
    content: { kind: "posting", document: posting },
    renderedText: renderPostingText(posting),
  });
  const resumeSnapshot = await createSnapshot(db, {
    userId,
    kind: "resume",
    jobId: job.id,
    sourceId: draft.id,
    content: { kind: "resume", document: resumeDoc },
    renderedText: renderResumeText(resumeDoc),
    model: draft.model,
    promptVersion: draft.promptVersion,
  });
  let letterSnapshot: Snapshot | null = null;
  if (letter) {
    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
    const doc = coverLetterDocument(profile ?? null, { company: job.company, title: job.title }, letter.paragraphs);
    letterSnapshot = await createSnapshot(db, {
      userId,
      kind: "cover_letter",
      jobId: job.id,
      sourceId: letter.id,
      content: { kind: "cover_letter", document: doc },
      renderedText: renderCoverLetterText(doc, { date: now }),
      model: letter.model,
      promptVersion: letter.promptVersion,
    });
  }

  const source = input.source?.trim().slice(0, 200);
  const [updated] = await db
    .update(applications)
    .set({
      status: "applied",
      submittedAt,
      ...(source ? { source } : {}),
      postingSnapshotId: postingSnapshot.id,
      resumeSnapshotId: resumeSnapshot.id,
      coverLetterSnapshotId: letterSnapshot?.id ?? null,
      updatedAt: now,
    })
    // Only if nobody froze it in the meantime (a double submit).
    .where(and(eq(applications.id, application.id), eq(applications.userId, userId), isNull(applications.resumeSnapshotId)))
    .returning();
  if (!updated) return fail("This application was just marked as applied. The first submission's files were kept.");

  return { ok: true, application: updated, snapshots: { posting: postingSnapshot, resume: resumeSnapshot, coverLetter: letterSnapshot }, warnings };
}
