import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db";
import {
  achievements,
  applications,
  CAREER_PATHS,
  EVIDENCE_LABELS,
  jobRequirements,
  jobs,
  profiles,
  snapshots,
  type ApplicationStatus,
  type CareerPath,
  type EvidenceLabel,
} from "@/db/schema";
import { jobAlerts, type AlertJob, type JobAlert } from "./alerts";
import { computeFit, type FitProfile, type FitResult } from "./fit";
import { COMPANY_SIZES, isIsoDate, isUuid, POSTING_STATUSES, type CompanySize, type PostingStatus } from "./format";

/*
 * Job intake and the job page's data. Every query filters by userId; ids that
 * arrive from forms are never trusted on their own.
 */

export type Job = typeof jobs.$inferSelect;
export type JobRequirement = typeof jobRequirements.$inferSelect;
export type Application = typeof applications.$inferSelect;

/** A problem the owner can fix; its message is safe to show. */
export class JobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobError";
  }
}

export const MAX_POSTING_CHARS = 60_000;

export type NewJobInput = {
  postingText: string;
  sourceUrl?: string;
  company?: string;
  title?: string;
  location?: string;
  compText?: string;
  deadline?: string;
  requisitionId?: string;
  interest?: number | null;
  growth?: number | null;
  companySize?: string;
};

function rating(value: number | null | undefined, name: string): number {
  if (value == null) return 3;
  if (!Number.isInteger(value) || value < 1 || value > 5) throw new JobError(`${name} must be a whole number from 1 to 5.`);
  return value;
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], name: string, fallback?: T): T {
  if (!value && fallback) return fallback;
  if (value && (allowed as readonly string[]).includes(value)) return value as T;
  throw new JobError(`Choose a valid ${name}.`);
}

/** Checks and cleans intake input. Throws JobError with a message for the form. */
export function validateNewJob(input: NewJobInput) {
  const postingText = input.postingText.trim();
  if (!postingText) throw new JobError("Paste the job description.");
  if (postingText.length > MAX_POSTING_CHARS) throw new JobError("That posting is very long. Paste just the job description.");
  const sourceUrl = (input.sourceUrl ?? "").trim();
  if (sourceUrl && !/^https?:\/\/\S+$/i.test(sourceUrl)) throw new JobError("The source link should start with http:// or https://.");
  const deadline = (input.deadline ?? "").trim();
  if (deadline && !isIsoDate(deadline)) throw new JobError("Use YYYY-MM-DD for the deadline.");
  return {
    postingText,
    sourceUrl,
    company: (input.company ?? "").trim(),
    title: (input.title ?? "").trim(),
    location: (input.location ?? "").trim(),
    compText: (input.compText ?? "").trim(),
    deadline,
    requisitionId: (input.requisitionId ?? "").trim(),
    interest: rating(input.interest, "Interest"),
    growth: rating(input.growth, "Growth"),
    companySize: oneOf<CompanySize>(input.companySize, COMPANY_SIZES, "company size", "unknown"),
  };
}

/** Saves the posting and starts its application at "saved". */
export async function createJob(db: Database, userId: string, input: NewJobInput): Promise<Job> {
  const values = validateNewJob(input);
  const [job] = await db.insert(jobs).values({ ...values, userId }).returning();
  try {
    await db.insert(applications).values({ userId, jobId: job.id, status: "saved" });
  } catch (error) {
    // No transactions on neon-http: undo the job so intake is all-or-nothing.
    await db.delete(jobs).where(and(eq(jobs.id, job.id), eq(jobs.userId, userId)));
    throw error;
  }
  return job;
}

export async function getJob(db: Database, userId: string, jobId: string): Promise<Job | null> {
  if (!isUuid(jobId)) return null;
  const [job] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)));
  return job ?? null;
}

export async function requireJob(db: Database, userId: string, jobId: string): Promise<Job> {
  const job = await getJob(db, userId, jobId);
  if (!job) throw new JobError("That job wasn't found.");
  return job;
}

export async function listRequirements(db: Database, userId: string, jobId: string): Promise<JobRequirement[]> {
  return db
    .select()
    .from(jobRequirements)
    .where(and(eq(jobRequirements.jobId, jobId), eq(jobRequirements.userId, userId)))
    .orderBy(asc(jobRequirements.position));
}

async function loadProfile(db: Database, userId: string): Promise<FitProfile> {
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
  return profile ? { compMin: profile.compMin, remoteOk: profile.remoteOk, targetLocations: profile.targetLocations, fitWeights: profile.fitWeights } : null;
}

async function loadAlertJobs(db: Database, userId: string): Promise<AlertJob[]> {
  const rows = await db
    .select({ job: jobs, status: applications.status })
    .from(jobs)
    .leftJoin(applications, and(eq(applications.jobId, jobs.id), eq(applications.userId, userId)))
    .where(eq(jobs.userId, userId));
  return rows.map(({ job, status }) => toAlertJob(job, status));
}

function toAlertJob(job: Job, status: ApplicationStatus | null): AlertJob {
  return {
    id: job.id,
    company: job.company,
    title: job.title,
    requisitionId: job.requisitionId,
    deadline: job.deadline,
    capturedAt: job.capturedAt,
    postingStatus: job.postingStatus,
    applicationStatus: status,
  };
}

export type JobListItem = {
  job: Job;
  applicationStatus: ApplicationStatus | null;
  fit: FitResult;
  alerts: JobAlert[];
};

/** Every job, best fit first. */
export async function listJobs(db: Database, userId: string, now = new Date()): Promise<JobListItem[]> {
  const [rows, requirements, profile] = await Promise.all([
    db
      .select({ job: jobs, status: applications.status })
      .from(jobs)
      .leftJoin(applications, and(eq(applications.jobId, jobs.id), eq(applications.userId, userId)))
      .where(eq(jobs.userId, userId))
      .orderBy(desc(jobs.capturedAt)),
    db
      .select({ jobId: jobRequirements.jobId, kind: jobRequirements.kind, label: jobRequirements.label })
      .from(jobRequirements)
      .where(and(eq(jobRequirements.userId, userId), inArray(jobRequirements.kind, ["must", "preferred"]))),
    loadProfile(db, userId),
  ]);
  const byJob = new Map<string, { kind: JobRequirement["kind"]; label: EvidenceLabel | null }[]>();
  for (const r of requirements) {
    const list = byJob.get(r.jobId) ?? [];
    list.push({ kind: r.kind, label: r.label });
    byJob.set(r.jobId, list);
  }
  const alertJobs = rows.map(({ job, status }) => toAlertJob(job, status));
  const items = rows.map(({ job, status }, index) => ({
    job,
    applicationStatus: status,
    fit: computeFit(job, byJob.get(job.id) ?? [], profile),
    alerts: jobAlerts(alertJobs[index], alertJobs, now),
  }));
  return items.sort((a, b) => b.fit.score - a.fit.score || b.job.capturedAt.getTime() - a.job.capturedAt.getTime());
}

export type JobDetail = {
  job: Job;
  requirements: JobRequirement[];
  application: Application | null;
  /** Headlines for every achievement a requirement cites. */
  achievements: Map<string, { id: string; headline: string }>;
  achievementCount: number;
  fit: FitResult;
  alerts: JobAlert[];
};

export async function getJobDetail(db: Database, userId: string, jobId: string, now = new Date()): Promise<JobDetail | null> {
  const job = await getJob(db, userId, jobId);
  if (!job) return null;
  const [requirements, [application], profile, alertJobs, library] = await Promise.all([
    listRequirements(db, userId, jobId),
    db.select().from(applications).where(and(eq(applications.jobId, jobId), eq(applications.userId, userId))),
    loadProfile(db, userId),
    loadAlertJobs(db, userId),
    db.select({ id: achievements.id, headline: achievements.headline }).from(achievements).where(eq(achievements.userId, userId)),
  ]);
  const cited = new Set(requirements.flatMap((r) => r.achievementIds));
  const map = new Map(library.filter((a) => cited.has(a.id)).map((a) => [a.id, a]));
  const self = alertJobs.find((a) => a.id === job.id) ?? toAlertJob(job, application?.status ?? null);
  return {
    job,
    requirements,
    application: application ?? null,
    achievements: map,
    achievementCount: library.length,
    fit: computeFit(job, requirements, profile),
    alerts: jobAlerts(self, alertJobs, now),
  };
}

export type FitInput = { interest: number | null; growth: number | null; companySize: string; careerPath: string };

export async function updateJobFit(db: Database, userId: string, jobId: string, input: FitInput): Promise<void> {
  if (!isUuid(jobId)) throw new JobError("That job wasn't found.");
  if (input.interest == null || input.growth == null) throw new JobError("Rate interest and growth from 1 to 5.");
  const values = {
    interest: rating(input.interest, "Interest"),
    growth: rating(input.growth, "Growth"),
    companySize: oneOf<CompanySize>(input.companySize, COMPANY_SIZES, "company size"),
    careerPath: oneOf<CareerPath>(input.careerPath, CAREER_PATHS, "career path"),
  };
  const updated = await db
    .update(jobs)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)))
    .returning({ id: jobs.id });
  if (!updated.length) throw new JobError("That job wasn't found.");
}

export async function setPostingStatus(db: Database, userId: string, jobId: string, status: string): Promise<void> {
  const postingStatus = oneOf<PostingStatus>(status, POSTING_STATUSES, "posting status");
  await requireJob(db, userId, jobId);
  await db.update(jobs).set({ postingStatus, updatedAt: new Date() }).where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)));
}

/**
 * The owner's own call on a requirement. "auto" hands the label back to
 * matching (the current label stays until the next match).
 */
export async function overrideRequirementLabel(db: Database, userId: string, requirementId: string, value: string): Promise<{ jobId: string }> {
  if (!isUuid(requirementId)) throw new JobError("That requirement wasn't found.");
  const set =
    value === "auto"
      ? { labelOverridden: false }
      : { label: oneOf<EvidenceLabel>(value, EVIDENCE_LABELS, "evidence label"), labelOverridden: true };
  const [row] = await db
    .update(jobRequirements)
    .set(set)
    .where(and(eq(jobRequirements.id, requirementId), eq(jobRequirements.userId, userId)))
    .returning({ jobId: jobRequirements.jobId });
  if (!row) throw new JobError("That requirement wasn't found.");
  return row;
}

export const HAS_SNAPSHOTS_MESSAGE = "This job has submitted materials — withdraw it instead.";

/** Deletes a job with its requirements, drafts and application. Refused once anything was submitted. */
export async function deleteJob(db: Database, userId: string, jobId: string): Promise<void> {
  await requireJob(db, userId, jobId);
  const [frozen] = await db.select({ id: snapshots.id }).from(snapshots).where(eq(snapshots.jobId, jobId)).limit(1);
  if (frozen) throw new JobError(HAS_SNAPSHOTS_MESSAGE);
  await db.delete(jobs).where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)));
}
