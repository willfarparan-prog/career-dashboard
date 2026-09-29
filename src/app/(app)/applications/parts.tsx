import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, cx, formatDate } from "@/components/ui";
import { dueState } from "@/lib/applications/dates";
import { updateNextActionAction } from "./actions";

/** "Oct 2, 2026" with an Overdue / Today marker. */
export function DueDate({ date, today, className }: { date: string; today: string; className?: string }) {
  const state = dueState(date, today);
  if (!state) return date ? <span className={className}>{date}</span> : null;
  return (
    <span className={cx("inline-flex flex-wrap items-center gap-1.5", className)}>
      <span className={cx(state === "overdue" && "font-medium text-bad", state === "today" && "font-medium text-warn")}>{formatDate(date)}</span>
      {state === "overdue" ? <Badge tone="bad">Overdue</Badge> : state === "today" ? <Badge tone="warn">Today</Badge> : null}
    </span>
  );
}

export function NextActionForm({ applicationId, nextAction, nextActionDate }: { applicationId: string; nextAction: string; nextActionDate: string }) {
  return (
    <ActionForm action={updateNextActionAction}>
      <input type="hidden" name="applicationId" value={applicationId} />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10.5rem_auto] sm:items-end">
        <label className="field">
          <span>Next action</span>
          <input className="input" name="nextAction" defaultValue={nextAction} maxLength={300} placeholder="e.g. Follow up with the recruiter" />
        </label>
        <label className="field">
          <span>By</span>
          <input className="input" type="date" name="nextActionDate" defaultValue={nextActionDate} />
        </label>
        <SubmitButton variant="secondary" pending="Saving…">
          Save
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export const SOURCE_SUGGESTIONS = ["Company website", "LinkedIn", "Indeed", "Referral", "Recruiter", "Email"];

export function SourceSuggestions({ id }: { id: string }) {
  return (
    <datalist id={id}>
      {SOURCE_SUGGESTIONS.map((source) => (
        <option key={source} value={source} />
      ))}
    </datalist>
  );
}
