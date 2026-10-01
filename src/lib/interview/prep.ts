import { and, desc, eq } from "drizzle-orm";
import type { Database } from "@/db";
import { interviewPreps, jobs, practiceAttempts, type PracticeFeedback, type PrepContent } from "@/db/schema";
import { InterviewInputError } from "./stories";

/* Storage for per-job prep packs and practice attempts. Claude calls live in src/lib/ai/tasks. */

export type InterviewPrep = typeof interviewPreps.$inferSelect;
export type PracticeAttempt = typeof practiceAttempts.$inferSelect;

export async function getPrep(db: Database, userId: string, jobId: string): Promise<InterviewPrep | null> {
  const [row] = await db.select().from(interviewPreps).where(and(eq(interviewPreps.userId, userId), eq(interviewPreps.jobId, jobId)));
  return row ?? null;
}

/** Saves a generated pack, replacing the previous one but keeping the owner's company notes. */
export async function savePrepContent(db: Database, userId: string, jobId: string, content: PrepContent, meta: { model: string; promptVersion: string }): Promise<InterviewPrep> {
  const now = new Date();
  const [row] = await db
    .insert(interviewPreps)
    .values({ userId, jobId, content, generatedAt: now, ...meta })
    .onConflictDoUpdate({ target: interviewPreps.jobId, set: { content, generatedAt: now, ...meta, updatedAt: now } })
    .returning();
  return row;
}

export async function saveCompanyNotes(db: Database, userId: string, jobId: string, notes: string): Promise<InterviewPrep> {
  const [job] = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)));
  if (!job) throw new InterviewInputError("That job wasn't found.");
  const companyNotes = notes.trim();
  const [row] = await db
    .insert(interviewPreps)
    .values({ userId, jobId, companyNotes })
    .onConflictDoUpdate({ target: interviewPreps.jobId, set: { companyNotes, updatedAt: new Date() } })
    .returning();
  return row;
}

export type NewAttempt = { jobId: string | null; question: string; competency: string; answer: string; feedback: PracticeFeedback; model: string; promptVersion: string };

export async function savePracticeAttempt(db: Database, userId: string, attempt: NewAttempt): Promise<PracticeAttempt> {
  const [row] = await db.insert(practiceAttempts).values({ userId, ...attempt }).returning();
  return row;
}

export async function getPracticeAttempt(db: Database, userId: string, id: string): Promise<PracticeAttempt | null> {
  const [row] = await db.select().from(practiceAttempts).where(and(eq(practiceAttempts.id, id), eq(practiceAttempts.userId, userId)));
  return row ?? null;
}

export async function listPracticeAttempts(db: Database, userId: string, options: { question?: string; limit?: number } = {}): Promise<PracticeAttempt[]> {
  const where = options.question ? and(eq(practiceAttempts.userId, userId), eq(practiceAttempts.question, options.question)) : eq(practiceAttempts.userId, userId);
  return db
    .select()
    .from(practiceAttempts)
    .where(where)
    .orderBy(desc(practiceAttempts.createdAt))
    .limit(options.limit ?? 20);
}

/** Spoken length: about 130 words a minute; 1.5–2 minutes suits most behavioral answers. */
export function answerLength(answer: string): { words: number; seconds: number; note: string } {
  const words = answer.trim() ? answer.trim().split(/\s+/).length : 0;
  const seconds = Math.round((words / 130) * 60);
  const note =
    words < 120
      ? "Short. Most behavioral answers need 1.5–2 minutes to cover the situation, what you did and the result."
      : words > 330
        ? "Long. Over about 2.5 minutes, interviewers lose the thread; cut the setup and keep the action and result."
        : "A good spoken length.";
  return { words, seconds, note };
}
