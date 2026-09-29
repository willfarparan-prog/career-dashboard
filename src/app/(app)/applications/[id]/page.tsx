import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Notice, PageHeader, StatusBadge, StatusPath, STATUS_OPTIONS, formatDate } from "@/components/ui";
import { requireDatabase } from "@/db";
import { isoDay } from "@/lib/applications/dates";
import { getApplication, isFrozen } from "@/lib/applications/queries";
import { requireViewer } from "@/lib/auth/owner";
import { updateApplicationAction } from "../actions";
import { DueDate, SourceSuggestions } from "../parts";
import { SentFileList } from "../sent-files";

export const metadata = { title: "Application" };

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId } = await requireViewer();
  const detail = await getApplication(requireDatabase(), userId, id);
  if (!detail) notFound();
  const { application, job, sent } = detail;
  const frozen = isFrozen(application);
  const statusOptions = STATUS_OPTIONS.filter((option) => option.value !== "applied" || frozen || application.status === "applied");
  const today = isoDay(new Date());

  return (
    <>
      <PageHeader
        back={{ href: "/applications", label: "Applications" }}
        title={job.title || "Untitled job"}
        description={
          <>
            {job.company || "Company not set"}
            {job.location ? ` · ${job.location}` : ""} ·{" "}
            <Link href={`/jobs/${job.id}`} className="text-primary hover:underline">
              Open job
            </Link>
          </>
        }
        actions={<StatusBadge status={application.status} />}
      />
      <div className="mb-3 rounded-lg border border-border bg-card px-4 py-3 shadow-card">
        <StatusPath status={application.status} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card title="Tracking" description="Status, follow-ups and who you're talking to.">
          <ActionForm action={updateApplicationAction} className="space-y-4">
            <input type="hidden" name="applicationId" value={application.id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field">
                <span>Status</span>
                <select name="status" defaultValue={application.status} className="input">
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {!frozen ? <small>“Applied” is set by Mark as applied on the job page, which saves the files you sent.</small> : null}
              </label>
              <label className="field">
                <span>Source</span>
                <input className="input" name="source" defaultValue={application.source} maxLength={200} list="application-sources" placeholder="Where you found or sent it" />
                <SourceSuggestions id="application-sources" />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10.5rem]">
              <label className="field">
                <span>Next action</span>
                <input className="input" name="nextAction" defaultValue={application.nextAction} maxLength={300} placeholder="e.g. Follow up with the recruiter" />
              </label>
              <label className="field">
                <span>By</span>
                <input className="input" type="date" name="nextActionDate" defaultValue={application.nextActionDate} />
              </label>
            </div>

            <fieldset>
              <legend className="mb-2 text-sm font-medium">Contact</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="field">
                  <span>Name</span>
                  <input className="input" name="contactName" defaultValue={application.contactName} maxLength={200} autoComplete="off" />
                </label>
                <label className="field">
                  <span>Email</span>
                  <input className="input" type="email" name="contactEmail" defaultValue={application.contactEmail} maxLength={320} autoComplete="off" />
                </label>
                <label className="field sm:col-span-2">
                  <span>Note</span>
                  <input className="input" name="contactNote" defaultValue={application.contactNote} maxLength={2000} placeholder="e.g. Recruiter, met at the September meetup" />
                </label>
              </div>
            </fieldset>

            <label className="field">
              <span>Notes</span>
              <textarea className="input" name="notes" defaultValue={application.notes} rows={5} maxLength={10000} placeholder="Interview prep, questions to ask, how it went…" />
            </label>

            <SubmitButton pending="Saving…">Save</SubmitButton>
          </ActionForm>
        </Card>

        <div className="space-y-4">
          <Card title="What you sent" description={frozen ? "Exact copies saved when you applied. They can't be changed." : undefined}>
            {frozen ? (
              <SentFileList sent={sent} />
            ) : (
              <Notice>
                Not applied yet. When you send it, use{" "}
                <Link href={`/jobs/${job.id}#application`} className="font-medium underline">
                  Mark as applied
                </Link>{" "}
                on the job page to save the exact resume, cover letter and posting.
              </Notice>
            )}
          </Card>

          <Card title="Timeline">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Added</dt>
                <dd>{formatDate(application.createdAt)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Applied</dt>
                <dd>{application.submittedAt ? formatDate(application.submittedAt) : "—"}</dd>
              </div>
              {application.nextActionDate ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Next action</dt>
                  <dd className="text-right">
                    <DueDate date={application.nextActionDate} today={today} className="justify-end" />
                  </dd>
                </div>
              ) : null}
              {job.deadline ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Deadline</dt>
                  <dd className="text-right">{job.deadline}</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Last updated</dt>
                <dd>{formatDate(application.updatedAt)}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
