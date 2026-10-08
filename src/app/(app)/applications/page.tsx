import Link from "next/link";
import { ButtonLink, EmptyState, PageHeader, StatusBadge, STATUS_OPTIONS, formatDate } from "@/components/ui";
import { requireDatabase } from "@/db";
import { APPLICATION_STATUSES, type ApplicationStatus } from "@/db/schema";
import { dueState, todayIso } from "@/lib/applications/dates";
import { groupByStatus, isFrozen, listApplications, type ApplicationListItem } from "@/lib/applications/queries";
import { requireViewer } from "@/lib/auth/owner";
import { DueDate } from "./parts";
import { SentFileLinks } from "./sent-files";
import { StatusSelect } from "./status-select";

export const metadata = { title: "Applications" };

const LABEL = Object.fromEntries(STATUS_OPTIONS.map((option) => [option.value, option.label])) as Record<ApplicationStatus, string>;

const HINT: Record<ApplicationStatus, string> = {
  saved: "Saved jobs",
  drafting: "Resume in progress",
  ready: "Ready to send",
  applied: "Waiting to hear back",
  interview: "Talking to them",
  offer: "Offer in hand",
  rejected: "Closed by them",
  withdrawn: "Closed by you",
};

function ApplicationCard({ item, today }: { item: ApplicationListItem; today: string }) {
  const frozen = isFrozen(item);
  const contact = [item.contactName, item.contactEmail].filter(Boolean);
  return (
    <article className="min-w-0 rounded-lg border border-border bg-card p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/jobs/${item.jobId}`} className="block font-medium leading-snug break-words hover:underline">
            {item.job.title || "Untitled job"}
          </Link>
          <p className="truncate text-xs text-muted-foreground">{item.job.company || "Company not set"}</p>
        </div>
        <StatusBadge status={item.status} />
      </div>

      <dl className="mt-2 space-y-1 text-xs">
        {item.submittedAt ? (
          <div className="flex flex-wrap gap-x-1.5">
            <dt className="text-muted-foreground">Applied</dt>
            <dd>
              {formatDate(item.submittedAt)}
              {item.source ? ` · ${item.source}` : ""}
            </dd>
          </div>
        ) : null}
        {item.nextAction || item.nextActionDate ? (
          <div>
            <dt className="text-muted-foreground">Next</dt>
            <dd className="break-words">
              {item.nextAction || "Follow up"}
              {item.nextActionDate ? (
                <>
                  {" "}
                  <DueDate date={item.nextActionDate} today={today} />
                </>
              ) : null}
            </dd>
          </div>
        ) : null}
        {contact.length ? (
          <div className="flex min-w-0 flex-wrap gap-x-1.5">
            <dt className="text-muted-foreground">Contact</dt>
            <dd className="min-w-0 break-all">
              {item.contactName}
              {item.contactEmail ? (
                <>
                  {item.contactName ? " · " : ""}
                  <a href={`mailto:${item.contactEmail}`} className="text-primary hover:underline">
                    {item.contactEmail}
                  </a>
                </>
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>

      {frozen ? (
        <div className="mt-2 rounded-md bg-muted px-2 py-1.5">
          <p className="mb-0.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Files sent</p>
          <SentFileLinks ids={{ resume: item.resumeSnapshotId, coverLetter: item.coverLetterSnapshotId, posting: item.postingSnapshotId }} />
        </div>
      ) : null}

      <div className="mt-2.5 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <StatusSelect applicationId={item.id} status={item.status} frozen={frozen} label={`Status for ${item.job.title || "this job"}`} compact />
        </div>
        <Link href={`/applications/${item.id}`} className="shrink-0 text-xs font-medium text-primary hover:underline">
          Details
        </Link>
      </div>
    </article>
  );
}

export default async function ApplicationsPage() {
  const { userId } = await requireViewer();
  const items = await listApplications(requireDatabase(), userId);
  const today = todayIso();

  if (!items.length) {
    return (
      <>
        <PageHeader title="Applications" description="Track every job from saved to offer." />
        <EmptyState title="Nothing to track yet" action={<ButtonLink href="/jobs">Add a job</ButtonLink>}>
          Every job you add shows up here as Saved. When you apply, mark it applied on the job page and the exact files you sent are kept with it.
        </EmptyState>
      </>
    );
  }

  const groups = groupByStatus(items);
  const overdue = items.filter((item) => dueState(item.nextActionDate, today) === "overdue" && item.status !== "rejected" && item.status !== "withdrawn").length;

  return (
    <>
      <PageHeader
        title="Applications"
        description={
          <>
            {items.length} {items.length === 1 ? "job" : "jobs"} tracked
            {overdue ? <span className="text-bad"> · {overdue} overdue {overdue === 1 ? "follow-up" : "follow-ups"}</span> : null}. Applied ones link to the exact files you sent.
          </>
        }
        actions={<ButtonLink href="/jobs" variant="secondary">Add a job</ButtonLink>}
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {APPLICATION_STATUSES.map((status) => {
          const list = groups[status];
          return (
            <section key={status} aria-labelledby={`col-${status}`} className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-muted/50 p-2.5">
              <header className="flex items-baseline justify-between gap-2 px-1">
                <h2 id={`col-${status}`} className="text-sm font-semibold">
                  {LABEL[status]} <span className="font-normal text-muted-foreground tabular-nums">{list.length}</span>
                </h2>
                <span className="min-w-0 truncate text-xs text-muted-foreground">{HINT[status]}</span>
              </header>
              {list.length ? (
                list.map((item) => <ApplicationCard key={item.id} item={item} today={today} />)
              ) : (
                <p className="px-1 pb-1 text-xs text-muted-foreground">None</p>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
