import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db";
import { applications, INTERVIEW_OUTCOMES, INTERVIEW_STAGES, interviews, jobs, type ApplicationStatus, type InterviewOutcome, type InterviewStage } from "@/db/schema";
import { addDays, daysBetween, parseDay } from "@/lib/applications/dates";
import { InterviewInputError } from "./stories";

/* Interview rounds for a job: when, with whom, how it went, and the thank-you. */

export type Interview = typeof interviews.$inferSelect;

export const STAGE_LABELS: Record<InterviewStage, string> = {
  recruiter_screen: "Recruiter screen",
  hiring_manager: "Hiring manager",
  panel: "Panel",
  presentation: "Presentation / case",
  final: "Final",
  other: "Other",
};

export const OUTCOME_LABELS: Record<InterviewOutcome, string> = {
  pending: "Waiting to hear",
  advanced: "Moved forward",
  rejected: "Not moving forward",
  offer: "Offer",
};

export type InterviewInput = {
  stage: InterviewStage;
  date: string;
  interviewers: string;
  notes: string;
  debrief: string;
  thankYouSent: boolean;
  outcome: InterviewOutcome;
};

export function validateInterview(input: InterviewInput): InterviewInput {
  if (!(INTERVIEW_STAGES as readonly string[]).includes(input.stage)) throw new InterviewInputError("Pick a stage.");
  if (!(INTERVIEW_OUTCOMES as readonly string[]).includes(input.outcome)) throw new InterviewInputError("Pick an outcome.");
  const raw = input.date.trim();
  const date = raw ? parseDay(raw) : "";
  if (date === null) throw new InterviewInputError("Use a date like 2026-10-14.");
  return {
    stage: input.stage,
    date,
    interviewers: input.interviewers.trim(),
    notes: input.notes.trim(),
    debrief: input.debrief.trim(),
    thankYouSent: input.thankYouSent,
    outcome: input.outcome,
  };
}

async function ownJob(db: Database, userId: string, jobId: string) {
  const [row] = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)));
  if (!row) throw new InterviewInputError("That job wasn't found.");
}

export async function listInterviews(db: Database, userId: string, jobId: string): Promise<Interview[]> {
  return db
    .select()
    .from(interviews)
    .where(and(eq(interviews.userId, userId), eq(interviews.jobId, jobId)))
    .orderBy(asc(interviews.date), asc(interviews.createdAt));
}

export async function addInterview(db: Database, userId: string, jobId: string, input: InterviewInput): Promise<Interview> {
  await ownJob(db, userId, jobId);
  const [row] = await db.insert(interviews).values({ userId, jobId, ...validateInterview(input) }).returning();
  return row;
}

export async function updateInterview(db: Database, userId: string, id: string, input: InterviewInput): Promise<Interview | null> {
  const [row] = await db
    .update(interviews)
    .set({ ...validateInterview(input), updatedAt: new Date() })
    .where(and(eq(interviews.id, id), eq(interviews.userId, userId)))
    .returning();
  return row ?? null;
}

export async function deleteInterview(db: Database, userId: string, id: string): Promise<Interview | null> {
  const [row] = await db.delete(interviews).where(and(eq(interviews.id, id), eq(interviews.userId, userId))).returning();
  return row ?? null;
}

export type InterviewAction = {
  interviewId: string;
  jobId: string;
  company: string;
  title: string;
  status: ApplicationStatus | null;
  label: string;
  date: string;
  daysLeft: number;
};

/** How long after an interview an unsent thank-you keeps showing as overdue. */
const THANK_YOU_GRACE_DAYS = 7;

/**
 * Interview-driven next actions: rounds coming up within `until`, and
 * thank-you notes not yet sent (due the day after, shown for a week).
 */
export async function interviewActions(db: Database, userId: string, today: string, until: string): Promise<InterviewAction[]> {
  const rows = await db
    .select({ interview: interviews, company: jobs.company, title: jobs.title, status: applications.status })
    .from(interviews)
    .innerJoin(jobs, and(eq(jobs.id, interviews.jobId), eq(jobs.userId, userId)))
    .leftJoin(applications, and(eq(applications.jobId, jobs.id), eq(applications.userId, userId)))
    .where(and(eq(interviews.userId, userId), inArray(interviews.outcome, ["pending", "advanced", "offer"])));
  const items: InterviewAction[] = [];
  for (const { interview, company, title, status } of rows) {
    if (!interview.date) continue;
    const base = { interviewId: interview.id, jobId: interview.jobId, company, title, status };
    if (interview.date >= today && interview.date <= until) {
      items.push({ ...base, label: `${STAGE_LABELS[interview.stage]} interview`, date: interview.date, daysLeft: daysBetween(today, interview.date) });
    }
    const thanksDue = addDays(interview.date, 1);
    if (!interview.thankYouSent && interview.date < today && daysBetween(thanksDue, today) <= THANK_YOU_GRACE_DAYS && thanksDue <= until) {
      items.push({ ...base, label: "Send a thank-you note", date: thanksDue, daysLeft: daysBetween(today, thanksDue) });
    }
  }
  return items;
}
