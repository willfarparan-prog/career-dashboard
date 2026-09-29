import Link from "next/link";
import { Badge, ButtonLink, EmptyState, formatDate, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { getDatabase } from "@/db";
import { requireViewer } from "@/lib/auth/owner";
import { fitSummary } from "@/lib/jobs/fit";
import { formatComp, jobCompany, jobTitle, REMOTE_LABELS, todayIso } from "@/lib/jobs/format";
import { listJobs, type JobListItem } from "@/lib/jobs/jobs";
import { FitBreakdown, FitScore } from "./[id]/fit-breakdown";

function isArchived({ job, applicationStatus }: JobListItem) {
  return job.postingStatus === "closed" || applicationStatus === "rejected" || applicationStatus === "withdrawn";
}

export default async function JobsPage() {
  const { userId } = await requireViewer();
  const db = getDatabase();
  if (!db) return <Notice tone="warn">The database isn&apos;t connected yet. Set DATABASE_URL and reload.</Notice>;
  const items = await listJobs(db, userId);
  const open = items.filter((item) => !isArchived(item));
  const archived = items.filter(isArchived);

  return (
    <>
      <PageHeader
        title="Jobs"
        description="Ranked by your fit score. Open any score to see how it adds up."
        actions={items.length ? <ButtonLink href="/jobs/new">Add job</ButtonLink> : null}
      />

      {!items.length ? (
        <EmptyState title="No jobs yet" action={<ButtonLink href="/jobs/new">Add your first job</ButtonLink>}>
          Paste a posting. Claude pulls out the requirements, matches them to your achievements, and the job is ranked by fit.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {open.length ? (
            <ul className="space-y-3">
              {open.map((item) => (
                <JobRow key={item.job.id} item={item} />
              ))}
            </ul>
          ) : (
            <EmptyState title="Nothing open right now" action={<ButtonLink href="/jobs/new">Add a job</ButtonLink>}>
              Every saved job is closed or finished.
            </EmptyState>
          )}

          {archived.length ? (
            <details>
              <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
                Closed or finished ({archived.length})
              </summary>
              <ul className="mt-3 space-y-3">
                {archived.map((item) => (
                  <JobRow key={item.job.id} item={item} />
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      )}
    </>
  );
}

function JobRow({ item }: { item: JobListItem }) {
  const { job, applicationStatus, fit, alerts } = item;
  const comp = formatComp(job);
  const deadlinePassed = Boolean(job.deadline) && job.deadline < todayIso();
  const meta = [jobCompany(job), job.location, job.remoteType === "unknown" ? "" : REMOTE_LABELS[job.remoteType]].filter(Boolean).join(" · ");
  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <FitScore score={fit.score} title={fitSummary(fit)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <div className="min-w-0">
              <Link href={`/jobs/${job.id}`} className="font-medium break-words hover:underline">
                {jobTitle(job)}
              </Link>
              <p className="text-sm break-words text-muted-foreground">{meta}</p>
            </div>
            {applicationStatus ? <StatusBadge status={applicationStatus} /> : null}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {comp ? <Badge>{comp}</Badge> : null}
            {job.deadline ? <Badge tone={deadlinePassed ? "bad" : "neutral"}>Due {formatDate(job.deadline)}</Badge> : null}
            {!job.analyzedAt ? <Badge>Not analyzed</Badge> : !job.matchedAt ? <Badge>Evidence not matched</Badge> : null}
            {alerts.map((alert) => (
              <Badge key={`${alert.kind}-${alert.message}`} tone={alert.kind === "closed" ? "neutral" : "warn"} title={alert.message}>
                {alert.label}
              </Badge>
            ))}
          </div>
          {alerts.length ? (
            <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
              {alerts.map((alert) => (
                <li key={`${alert.kind}-${alert.message}`}>{alert.message}</li>
              ))}
            </ul>
          ) : null}

          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">How {fit.score} adds up</summary>
            <div className="mt-2">
              <FitBreakdown fit={fit} />
            </div>
          </details>
        </div>
      </div>
    </li>
  );
}
