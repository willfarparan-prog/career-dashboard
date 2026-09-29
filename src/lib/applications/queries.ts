import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db";
import { APPLICATION_STATUSES, applications, coverLetters, jobs, resumeDrafts, snapshots, type ApplicationStatus } from "@/db/schema";
import type { Snapshot } from "@/lib/snapshots/create";
import { parseDay } from "./dates";
import { draftReadiness } from "./readiness";

export type Application = typeof applications.$inferSelect;
export type Job = typeof jobs.$inferSelect;

export type ApplicationJob = Pick<Job, "id" | "company" | "title" | "location" | "deadline" | "postingStatus" | "sourceUrl">;
export type ApplicationListItem = Application & { job: ApplicationJob };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids from forms and URLs go into uuid columns; anything else would be a database error, not "not found". */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Once a resume snapshot exists the application was submitted and its files are final. */
export function isFrozen(application: Pick<Application, "resumeSnapshotId">): boolean {
  return Boolean(application.resumeSnapshotId);
}

const jobColumns = {
  id: jobs.id,
  company: jobs.company,
  title: jobs.title,
  location: jobs.location,
  deadline: jobs.deadline,
  postingStatus: jobs.postingStatus,
  sourceUrl: jobs.sourceUrl,
};

export async function listApplications(db: Database, userId: string): Promise<ApplicationListItem[]> {
  const rows = await db
    .select({ application: applications, job: jobColumns })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(and(eq(applications.userId, userId), eq(jobs.userId, userId)))
    .orderBy(desc(applications.updatedAt));
  return rows.map(({ application, job }) => ({ ...application, job }));
}

/** Within a status: dated next actions first (soonest first), then most recently updated. */
function compareItems(a: ApplicationListItem, b: ApplicationListItem): number {
  const da = parseDay(a.nextActionDate);
  const dbDay = parseDay(b.nextActionDate);
  if (da && dbDay && da !== dbDay) return da < dbDay ? -1 : 1;
  if (da && !dbDay) return -1;
  if (!da && dbDay) return 1;
  return b.updatedAt.getTime() - a.updatedAt.getTime();
}

export function groupByStatus(items: ApplicationListItem[]): Record<ApplicationStatus, ApplicationListItem[]> {
  const groups = Object.fromEntries(APPLICATION_STATUSES.map((status) => [status, [] as ApplicationListItem[]])) as Record<ApplicationStatus, ApplicationListItem[]>;
  for (const item of items) groups[item.status].push(item);
  for (const status of APPLICATION_STATUSES) groups[status].sort(compareItems);
  return groups;
}

export type SentFiles = { resume: Snapshot | null; coverLetter: Snapshot | null; posting: Snapshot | null };

export async function loadSentFiles(db: Database, userId: string, application: Application): Promise<SentFiles> {
  const ids = [application.resumeSnapshotId, application.coverLetterSnapshotId, application.postingSnapshotId].filter((id): id is string => Boolean(id));
  const rows = ids.length ? await db.select().from(snapshots).where(and(eq(snapshots.userId, userId), inArray(snapshots.id, ids))) : [];
  const byId = (id: string | null) => (id ? (rows.find((row) => row.id === id) ?? null) : null);
  return {
    resume: byId(application.resumeSnapshotId),
    coverLetter: byId(application.coverLetterSnapshotId),
    posting: byId(application.postingSnapshotId),
  };
}

export type ApplicationDetail = { application: Application; job: Job; sent: SentFiles };

export async function getApplication(db: Database, userId: string, applicationId: string): Promise<ApplicationDetail | null> {
  if (!isUuid(applicationId)) return null;
  const [row] = await db
    .select({ application: applications, job: jobs })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId), eq(jobs.userId, userId)));
  if (!row) return null;
  return { ...row, sent: await loadSentFiles(db, userId, row.application) };
}

export async function getApplicationForJob(db: Database, userId: string, jobId: string): Promise<Application | null> {
  if (!isUuid(jobId)) return null;
  const [row] = await db
    .select({ application: applications })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(and(eq(applications.jobId, jobId), eq(applications.userId, userId), eq(jobs.userId, userId)));
  return row?.application ?? null;
}

/**
 * The job's application row, created as "saved" if it's missing (jobs normally
 * get one when they're added). Null when the job isn't this user's.
 */
export async function ensureApplicationForJob(db: Database, userId: string, jobId: string): Promise<Application | null> {
  const existing = await getApplicationForJob(db, userId, jobId);
  if (existing) return existing;
  if (!isUuid(jobId)) return null;
  const [job] = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)));
  if (!job) return null;
  await db.insert(applications).values({ userId, jobId }).onConflictDoNothing({ target: applications.jobId });
  return getApplicationForJob(db, userId, jobId);
}

export type DraftOption = {
  id: string;
  name: string;
  approved: boolean;
  updatedAt: Date;
  proposedBullets: number;
  openErrors: number;
};

export type CoverLetterOption = { id: string; approved: boolean; paragraphs: number; updatedAt: Date };

/** What the "Mark as applied" form offers: the job's resume drafts and cover letters, newest first. */
export async function loadApplyOptions(db: Database, userId: string, jobId: string): Promise<{ drafts: DraftOption[]; coverLetters: CoverLetterOption[] }> {
  if (!isUuid(jobId)) return { drafts: [], coverLetters: [] };
  const [draftRows, letterRows] = await Promise.all([
    db
      .select({ id: resumeDrafts.id, name: resumeDrafts.name, status: resumeDrafts.status, updatedAt: resumeDrafts.updatedAt })
      .from(resumeDrafts)
      .where(and(eq(resumeDrafts.userId, userId), eq(resumeDrafts.jobId, jobId)))
      .orderBy(desc(resumeDrafts.updatedAt), asc(resumeDrafts.name)),
    db
      .select({ id: coverLetters.id, status: coverLetters.status, paragraphs: coverLetters.paragraphs, updatedAt: coverLetters.updatedAt })
      .from(coverLetters)
      .where(and(eq(coverLetters.userId, userId), eq(coverLetters.jobId, jobId)))
      .orderBy(desc(coverLetters.updatedAt)),
  ]);
  const readiness = await draftReadiness(db, userId, draftRows.map((draft) => draft.id));
  return {
    drafts: draftRows.map((draft) => ({
      id: draft.id,
      name: draft.name,
      approved: draft.status === "approved",
      updatedAt: draft.updatedAt,
      ...(readiness.get(draft.id) ?? { proposedBullets: 0, openErrors: 0 }),
    })),
    coverLetters: letterRows.map((letter) => ({
      id: letter.id,
      approved: letter.status === "approved",
      paragraphs: letter.paragraphs.filter((p) => p.text.trim()).length,
      updatedAt: letter.updatedAt,
    })),
  };
}
