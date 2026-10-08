import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Notice, formatDate, StatusPath } from "@/components/ui";
import { requireDatabase } from "@/db";
import { addDays, todayIso } from "@/lib/applications/dates";
import { ensureApplicationForJob, isFrozen, loadApplyOptions, loadSentFiles, type Application, type CoverLetterOption, type DraftOption } from "@/lib/applications/queries";
import { describeReadiness } from "@/lib/applications/readiness";
import { requireViewer } from "@/lib/auth/owner";
import { markAppliedAction } from "./actions";
import { NextActionForm, SourceSuggestions } from "./parts";
import { SentFileList } from "./sent-files";
import { StatusSelect } from "./status-select";

function draftLabel(draft: DraftOption) {
  const state = describeReadiness(draft);
  return `${draft.name || "Untitled draft"} — ${draft.approved ? "approved" : "not approved"}${state ? ` (${state})` : ""}`;
}

function letterLabel(letter: CoverLetterOption, index: number, total: number) {
  const name = total > 1 ? `Cover letter ${total - index}` : "Cover letter";
  return `${name} — ${letter.approved ? "approved" : "not approved"} · updated ${formatDate(letter.updatedAt)}`;
}

function MarkAppliedForm({ application, drafts, letters }: { application: Application; drafts: DraftOption[]; letters: CoverLetterOption[] }) {
  if (!drafts.length) {
    return (
      <Notice>
        <span className="font-medium">Mark as applied</span> becomes available once this job has a resume draft. Draft one above, then record what you sent here.
      </Notice>
    );
  }
  const today = todayIso();
  const defaultDraft = drafts.find((draft) => draft.approved) ?? drafts[0];
  const defaultLetter = letters.find((letter) => letter.approved && letter.paragraphs > 0);
  const anyUnfinished = drafts.some((draft) => !draft.approved || draft.openErrors > 0);

  return (
    <ActionForm action={markAppliedAction} className="space-y-4">
      <input type="hidden" name="applicationId" value={application.id} />
      <div>
        <h3 className="text-sm font-semibold">Mark as applied</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Saves permanent copies of the resume, cover letter and job posting exactly as they are now. They can&apos;t be edited later, so you&apos;ll always know
          what you sent.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field sm:col-span-2">
          <span>Resume you sent</span>
          <select name="resumeDraftId" defaultValue={defaultDraft.id} className="input" required>
            {drafts.map((draft) => (
              <option key={draft.id} value={draft.id}>
                {draftLabel(draft)}
              </option>
            ))}
          </select>
          {anyUnfinished ? <small>You can send a draft that isn&apos;t approved or still has errors. It&apos;s allowed, just double-check it first.</small> : null}
        </label>
        <label className="field sm:col-span-2">
          <span>Cover letter</span>
          <select name="coverLetterId" defaultValue={defaultLetter?.id ?? ""} className="input">
            <option value="">No cover letter</option>
            {letters.map((letter, index) => (
              <option key={letter.id} value={letter.id} disabled={letter.paragraphs === 0}>
                {letterLabel(letter, index, letters.length)}
                {letter.paragraphs === 0 ? " (empty)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Date applied</span>
          <input className="input" type="date" name="submittedOn" defaultValue={today} max={addDays(today, 1)} required />
        </label>
        <label className="field">
          <span>Applied through</span>
          <input className="input" name="source" defaultValue={application.source} maxLength={200} list="apply-sources" placeholder="e.g. Company website" />
          <SourceSuggestions id="apply-sources" />
        </label>
      </div>
      <SubmitButton pending="Saving copies…" confirm="Save permanent copies of these files and mark this job as applied? The saved copies can't be changed later.">
        Mark as applied
      </SubmitButton>
    </ActionForm>
  );
}

/** The application panel on the job page: status, next action, and "Mark as applied" (or the files sent). */
export async function ApplicationSection({ jobId }: { jobId: string }) {
  const { userId } = await requireViewer();
  const db = requireDatabase();
  const application = await ensureApplicationForJob(db, userId, jobId);
  if (!application) return null;
  const frozen = isFrozen(application);
  const [options, sent] = await Promise.all([frozen ? null : loadApplyOptions(db, userId, jobId), frozen ? loadSentFiles(db, userId, application) : null]);

  return (
    <div id="application" className="scroll-mt-6">
      <Card
        title="Application"
        description="Where this job stands and what's next."
        actions={
          <Link href={`/applications/${application.id}`} className="text-sm font-medium text-primary hover:underline">
            Tracker details
          </Link>
        }
      >
        <div className="mb-4">
          <StatusPath status={application.status} />
        </div>
        <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-start">
          <StatusSelect applicationId={application.id} status={application.status} frozen={frozen} />
          <NextActionForm applicationId={application.id} nextAction={application.nextAction} nextActionDate={application.nextActionDate} />
        </div>

        <div className="mt-5 border-t border-border pt-4">
          {frozen && sent ? (
            <div className="space-y-3">
              <p className="text-sm">
                <span className="font-medium">Applied {application.submittedAt ? formatDate(application.submittedAt) : ""}</span>
                {application.source ? <span className="text-muted-foreground"> · {application.source}</span> : null}
                <span className="text-muted-foreground"> — these are the exact versions you sent. They can&apos;t be changed.</span>
              </p>
              <SentFileList sent={sent} />
            </div>
          ) : options ? (
            <MarkAppliedForm application={application} drafts={options.drafts} letters={options.coverLetters} />
          ) : null}
        </div>
      </Card>
    </div>
  );
}
