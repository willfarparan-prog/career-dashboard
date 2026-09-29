import { and, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import type { Database } from "@/db";
import { achievements, coverLetters, jobs, resumeDrafts, type EvidencedText } from "@/db/schema";

/*
 * Cover letters for a job. Each generation is a new row (earlier versions are
 * kept); the owner edits paragraph text, and each paragraph keeps the
 * achievement ids it was drafted from. At most one letter per job is approved.
 */

export type CoverLetter = typeof coverLetters.$inferSelect;
export type CoverLetterStatus = CoverLetter["status"];

/** A problem the owner can fix; its message is safe to show. */
export class CoverLetterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoverLetterError";
  }
}

export function countWords(paragraphs: Array<EvidencedText | string>): number {
  return paragraphs.reduce((total, paragraph) => {
    const text = typeof paragraph === "string" ? paragraph : paragraph.text;
    return total + (text.trim() ? text.trim().split(/\s+/).length : 0);
  }, 0);
}

/** Trimmed, non-empty paragraphs with de-duplicated evidence. */
export function cleanParagraphs(paragraphs: EvidencedText[]): EvidencedText[] {
  return paragraphs
    .map((paragraph) => ({ text: paragraph.text.trim(), evidence: [...new Set(paragraph.evidence)] }))
    .filter((paragraph) => paragraph.text.length > 0);
}

export async function listCoverLetters(db: Database, userId: string, jobId: string): Promise<CoverLetter[]> {
  return db
    .select()
    .from(coverLetters)
    .where(and(eq(coverLetters.userId, userId), eq(coverLetters.jobId, jobId)))
    .orderBy(desc(coverLetters.createdAt), desc(coverLetters.id));
}

export async function latestCoverLetter(db: Database, userId: string, jobId: string): Promise<CoverLetter | null> {
  const [row] = await db
    .select()
    .from(coverLetters)
    .where(and(eq(coverLetters.userId, userId), eq(coverLetters.jobId, jobId)))
    .orderBy(desc(coverLetters.createdAt), desc(coverLetters.id))
    .limit(1);
  return row ?? null;
}

export async function getCoverLetter(db: Database, userId: string, id: string): Promise<CoverLetter | null> {
  const [row] = await db.select().from(coverLetters).where(and(eq(coverLetters.id, id), eq(coverLetters.userId, userId)));
  return row ?? null;
}

/** A resume draft the owner can base a letter on: theirs, and for this job or not tied to one. */
export async function findBaseDraft(db: Database, userId: string, jobId: string, draftId: string) {
  const [draft] = await db
    .select()
    .from(resumeDrafts)
    .where(and(eq(resumeDrafts.id, draftId), eq(resumeDrafts.userId, userId), or(eq(resumeDrafts.jobId, jobId), isNull(resumeDrafts.jobId))));
  return draft ?? null;
}

export type NewCoverLetter = {
  jobId: string;
  draftId?: string | null;
  paragraphs: EvidencedText[];
  model?: string;
  promptVersion?: string;
};

export async function createCoverLetter(db: Database, userId: string, input: NewCoverLetter): Promise<CoverLetter> {
  const [job] = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, input.jobId), eq(jobs.userId, userId)));
  if (!job) throw new CoverLetterError("That job wasn't found.");
  if (input.draftId && !(await findBaseDraft(db, userId, input.jobId, input.draftId))) {
    throw new CoverLetterError("That resume draft wasn't found for this job.");
  }
  const paragraphs = cleanParagraphs(input.paragraphs);
  if (!paragraphs.length) throw new CoverLetterError("The letter came back empty. Please try again.");
  const [row] = await db
    .insert(coverLetters)
    .values({
      userId,
      jobId: input.jobId,
      draftId: input.draftId ?? null,
      paragraphs,
      status: "draft",
      model: input.model ?? "",
      promptVersion: input.promptVersion ?? "",
    })
    .returning();
  return row;
}

/**
 * Saves edited paragraph text. Paragraph i keeps the evidence it was drafted
 * with; a cleared paragraph is removed along with its evidence. Changing the
 * text of an approved letter moves it back to draft, so approval always
 * refers to the exact words.
 */
export async function updateCoverLetterParagraphs(db: Database, userId: string, id: string, texts: string[]): Promise<CoverLetter | null> {
  const letter = await getCoverLetter(db, userId, id);
  if (!letter) return null;
  const paragraphs = cleanParagraphs(texts.map((text, index) => ({ text: text.replace(/\r\n/g, "\n"), evidence: letter.paragraphs[index]?.evidence ?? [] })));
  if (!paragraphs.length) throw new CoverLetterError("A letter needs at least one paragraph.");
  const changed = JSON.stringify(paragraphs) !== JSON.stringify(cleanParagraphs(letter.paragraphs));
  const [row] = await db
    .update(coverLetters)
    .set({ paragraphs, status: changed ? "draft" : letter.status, updatedAt: new Date() })
    .where(and(eq(coverLetters.id, id), eq(coverLetters.userId, userId)))
    .returning();
  return row ?? null;
}

/** Approving one letter returns any other approved letter for the job to draft. */
export async function setCoverLetterStatus(db: Database, userId: string, id: string, status: CoverLetterStatus): Promise<CoverLetter | null> {
  const letter = await getCoverLetter(db, userId, id);
  if (!letter) return null;
  if (status === "approved") {
    if (!cleanParagraphs(letter.paragraphs).length) throw new CoverLetterError("An empty letter can't be approved.");
    await db
      .update(coverLetters)
      .set({ status: "draft", updatedAt: new Date() })
      .where(and(eq(coverLetters.userId, userId), eq(coverLetters.jobId, letter.jobId), eq(coverLetters.status, "approved"), ne(coverLetters.id, id)));
  }
  const [row] = await db
    .update(coverLetters)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(coverLetters.id, id), eq(coverLetters.userId, userId)))
    .returning();
  return row ?? null;
}

export async function deleteCoverLetter(db: Database, userId: string, id: string): Promise<CoverLetter | null> {
  const [row] = await db.delete(coverLetters).where(and(eq(coverLetters.id, id), eq(coverLetters.userId, userId))).returning();
  return row ?? null;
}

export type EvidenceItem = { id: string; headline: string };

/** Headlines for the achievements cited by these letters (the owner's only). */
export async function loadEvidence(db: Database, userId: string, letters: CoverLetter[]): Promise<Map<string, EvidenceItem>> {
  const ids = [...new Set(letters.flatMap((letter) => letter.paragraphs.flatMap((paragraph) => paragraph.evidence)))];
  if (!ids.length) return new Map();
  const rows = await db
    .select({ id: achievements.id, headline: achievements.headline })
    .from(achievements)
    .where(and(eq(achievements.userId, userId), inArray(achievements.id, ids)));
  return new Map(rows.map((row) => [row.id, row]));
}
