import { and, count, desc, eq, gte, inArray, isNotNull, ne, notInArray, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { achievements, applications, careerImports, jobs, resumeDrafts, roles, snapshots, type ApplicationStatus } from "@/db/schema";
import { addDays, daysBetween, isoDay, parseDay, startOfUtcMonth } from "@/lib/applications/dates";
import { describeReadiness, draftReadiness } from "@/lib/applications/readiness";
import { hasReadAGuide } from "@/lib/learn/progress";

/** Closed: nothing more to do. */
export const CLOSED_STATUSES: ApplicationStatus[] = ["rejected", "withdrawn"];
/** Not submitted yet: the job still needs work. */
export const OPEN_STATUSES: ApplicationStatus[] = ["saved", "drafting", "ready"];

export type OverviewStats = { active: number; appliedThisMonth: number; interviews: number };

export async function overviewStats(db: Database, userId: string, now = new Date()): Promise<OverviewStats> {
  const [[active], [applied], [interviews]] = await Promise.all([
    db.select({ n: count() }).from(applications).where(and(eq(applications.userId, userId), notInArray(applications.status, CLOSED_STATUSES))),
    db.select({ n: count() }).from(applications).where(and(eq(applications.userId, userId), gte(applications.submittedAt, startOfUtcMonth(now)))),
    db.select({ n: count() }).from(applications).where(and(eq(applications.userId, userId), eq(applications.status, "interview"))),
  ]);
  return { active: Number(active?.n ?? 0), appliedThisMonth: Number(applied?.n ?? 0), interviews: Number(interviews?.n ?? 0) };
}

export type NextActionItem = {
  applicationId: string;
  jobId: string;
  company: string;
  title: string;
  status: ApplicationStatus;
  nextAction: string;
  /** "YYYY-MM-DD" */
  date: string;
  /** Negative when overdue. */
  daysLeft: number;
};

/** Open applications whose next action is overdue or due within `windowDays`, soonest first. */
export async function nextActions(db: Database, userId: string, now = new Date(), windowDays = 7): Promise<NextActionItem[]> {
  const today = isoDay(now);
  const until = addDays(today, windowDays);
  const rows = await db
    .select({ application: applications, company: jobs.company, title: jobs.title })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(and(eq(applications.userId, userId), eq(jobs.userId, userId), ne(applications.nextActionDate, ""), notInArray(applications.status, CLOSED_STATUSES)));
  const items: NextActionItem[] = [];
  for (const { application, company, title } of rows) {
    const date = parseDay(application.nextActionDate);
    if (!date || date > until) continue;
    items.push({
      applicationId: application.id,
      jobId: application.jobId,
      company,
      title,
      status: application.status,
      nextAction: application.nextAction,
      date,
      daysLeft: daysBetween(today, date),
    });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.company.localeCompare(b.company));
}

export type DeadlineItem = { jobId: string; company: string; title: string; date: string; daysLeft: number; status: ApplicationStatus | null };

/** Jobs not applied to yet whose deadline falls between today and `windowDays` from now. */
export async function upcomingDeadlines(db: Database, userId: string, now = new Date(), windowDays = 14): Promise<DeadlineItem[]> {
  const today = isoDay(now);
  const until = addDays(today, windowDays);
  const rows = await db
    .select({ id: jobs.id, company: jobs.company, title: jobs.title, deadline: jobs.deadline, status: applications.status })
    .from(jobs)
    .leftJoin(applications, eq(applications.jobId, jobs.id))
    .where(and(eq(jobs.userId, userId), ne(jobs.deadline, ""), ne(jobs.postingStatus, "closed")));
  const items: DeadlineItem[] = [];
  for (const row of rows) {
    if (row.status && !OPEN_STATUSES.includes(row.status)) continue;
    const date = parseDay(row.deadline);
    if (!date || date < today || date > until) continue;
    items.push({ jobId: row.id, company: row.company, title: row.title, date, daysLeft: daysBetween(today, date), status: row.status });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.company.localeCompare(b.company));
}

export type AttentionItem = {
  key: string;
  kind: "job_analysis" | "job_match" | "draft" | "achievements_confirm" | "achievements_metrics";
  label: string;
  detail: string;
  href: string;
  tone: "warn" | "bad";
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const jobLabel = (job: { title: string; company: string }) => [job.title || "Untitled job", job.company].filter(Boolean).join(" · ");

/**
 * Things that block progress: open jobs not analyzed or matched, drafts with
 * bullets to review or unresolved errors, and achievements that need the
 * owner's confirmation or are missing metrics.
 */
export async function needsAttention(db: Database, userId: string): Promise<AttentionItem[]> {
  const jobRows = await db
    .select({ id: jobs.id, company: jobs.company, title: jobs.title, analyzedAt: jobs.analyzedAt, matchedAt: jobs.matchedAt, status: applications.status })
    .from(jobs)
    .leftJoin(applications, eq(applications.jobId, jobs.id))
    .where(and(eq(jobs.userId, userId), ne(jobs.postingStatus, "closed")))
    .orderBy(desc(jobs.createdAt));
  const openJobs = jobRows.filter((job) => !job.status || OPEN_STATUSES.includes(job.status));

  const items: AttentionItem[] = [];
  for (const job of openJobs) {
    if (!job.analyzedAt) {
      items.push({ key: `analyze-${job.id}`, kind: "job_analysis", label: jobLabel(job), detail: "Posting not analyzed yet", href: `/jobs/${job.id}`, tone: "warn" });
    } else if (!job.matchedAt) {
      items.push({ key: `match-${job.id}`, kind: "job_match", label: jobLabel(job), detail: "Requirements not matched to your evidence yet", href: `/jobs/${job.id}`, tone: "warn" });
    }
  }

  const openJobIds = openJobs.map((job) => job.id);
  if (openJobIds.length) {
    const drafts = await db
      .select({ id: resumeDrafts.id, name: resumeDrafts.name, jobId: resumeDrafts.jobId })
      .from(resumeDrafts)
      .where(and(eq(resumeDrafts.userId, userId), inArray(resumeDrafts.jobId, openJobIds)))
      .orderBy(desc(resumeDrafts.updatedAt));
    const readiness = await draftReadiness(db, userId, drafts.map((draft) => draft.id));
    for (const draft of drafts) {
      const state = readiness.get(draft.id);
      if (!state || (!state.proposedBullets && !state.openErrors) || !draft.jobId) continue;
      const job = openJobs.find((item) => item.id === draft.jobId);
      items.push({
        key: `draft-${draft.id}`,
        kind: "draft",
        label: `${draft.name || "Resume draft"}${job ? ` — ${jobLabel(job)}` : ""}`,
        detail: describeReadiness(state),
        href: `/jobs/${draft.jobId}/resume/${draft.id}`,
        tone: state.openErrors ? "bad" : "warn",
      });
    }
  }

  const [[toConfirm], [missingMetrics]] = await Promise.all([
    db.select({ n: count() }).from(achievements).where(and(eq(achievements.userId, userId), eq(achievements.factStatus, "needs_confirmation"))),
    db
      .select({ n: count() })
      .from(achievements)
      .where(and(eq(achievements.userId, userId), sql`jsonb_array_length(${achievements.missingMetrics}) > 0`)),
  ]);
  const confirmCount = Number(toConfirm?.n ?? 0);
  const metricsCount = Number(missingMetrics?.n ?? 0);
  if (confirmCount) {
    items.push({
      key: "achievements-confirm",
      kind: "achievements_confirm",
      label: `${plural(confirmCount, "achievement needs", "achievements need")} confirmation`,
      detail: "Drafts can't rely on them until you confirm they're true",
      href: "/achievements",
      tone: "bad",
    });
  }
  if (metricsCount) {
    items.push({
      key: "achievements-metrics",
      kind: "achievements_metrics",
      label: `${plural(metricsCount, "achievement is", "achievements are")} missing metrics`,
      detail: "Add numbers you can stand behind, or leave them out",
      href: "/achievements",
      tone: "warn",
    });
  }
  return items;
}

export type ChecklistStep = { key: string; label: string; description: string; done: boolean; href: string };

/** The getting-started path. Shown on the overview until every step is done. */
export async function gettingStarted(db: Database, userId: string): Promise<{ steps: ChecklistStep[]; done: boolean }> {
  const n = (rows: Array<{ n: number }>) => Number(rows[0]?.n ?? 0);
  const [readGuide, imports, roleCount, verified, jobRows, draftRows, approved, snapshotCount, submittedRows] = await Promise.all([
    hasReadAGuide(db, userId),
    db.select({ n: count() }).from(careerImports).where(eq(careerImports.userId, userId)).then(n),
    db.select({ n: count() }).from(roles).where(eq(roles.userId, userId)).then(n),
    db.select({ n: count() }).from(achievements).where(and(eq(achievements.userId, userId), eq(achievements.factStatus, "verified"))).then(n),
    db.select({ id: jobs.id }).from(jobs).where(eq(jobs.userId, userId)).orderBy(desc(jobs.createdAt)).limit(1),
    db
      .select({ id: resumeDrafts.id, jobId: resumeDrafts.jobId })
      .from(resumeDrafts)
      .where(and(eq(resumeDrafts.userId, userId), isNotNull(resumeDrafts.jobId)))
      .orderBy(desc(resumeDrafts.updatedAt))
      .limit(1),
    db.select({ n: count() }).from(resumeDrafts).where(and(eq(resumeDrafts.userId, userId), eq(resumeDrafts.status, "approved"))).then(n),
    db.select({ n: count() }).from(snapshots).where(eq(snapshots.userId, userId)).then(n),
    db.select({ id: applications.id }).from(applications).where(and(eq(applications.userId, userId), isNotNull(applications.resumeSnapshotId))).limit(1),
  ]);
  const latestJob = jobRows[0];
  const latestDraft = draftRows[0];

  const steps: ChecklistStep[] = [
    {
      key: "learn",
      label: "Read a field guide",
      description: "Learn how the role you're targeting works: the workflow, the metrics, the tools and how interviews run.",
      done: readGuide,
      href: "/learn",
    },
    {
      key: "import",
      label: "Import your resume",
      description: "Paste or upload it. Claude pulls out roles and achievements for you to review.",
      done: imports > 0 || roleCount > 0,
      href: "/profile/import",
    },
    {
      key: "verify",
      label: "Verify your facts",
      description: "Mark achievements and metrics you can stand behind as verified.",
      done: verified > 0,
      href: "/achievements",
    },
    { key: "job", label: "Add a job", description: "Paste a posting you want to apply for.", done: Boolean(latestJob), href: "/jobs" },
    {
      key: "draft",
      label: "Draft a tailored resume",
      description: "Claude drafts from your verified evidence. You review every bullet.",
      done: Boolean(latestDraft),
      href: latestJob ? `/jobs/${latestJob.id}` : "/jobs",
    },
    {
      key: "export",
      label: "Approve and export",
      description: "Approve the draft and download it as PDF or DOCX.",
      done: approved > 0 || snapshotCount > 0,
      href: latestDraft?.jobId ? `/jobs/${latestDraft.jobId}/resume/${latestDraft.id}` : "/jobs",
    },
    {
      key: "applied",
      label: "Mark it applied",
      description: "Saves exact copies of what you sent, so you can always look back.",
      done: submittedRows.length > 0,
      href: latestDraft?.jobId ? `/jobs/${latestDraft.jobId}#application` : "/applications",
    },
  ];
  return { steps, done: steps.every((step) => step.done) };
}
