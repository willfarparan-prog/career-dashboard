import { ActionForm, SubmitButton } from "@/components/forms";
import type { FactStatus } from "@/db/schema";
import type { ActionResult } from "@/lib/action-result";
import type { FactKind } from "@/lib/career/facts";
import { setFactStatusAction } from "./actions";

/** One-click "Mark verified" for anything not verified yet. */
export function VerifyButton({ kind, id, status }: { kind: FactKind; id: string; status: FactStatus }) {
  if (status === "verified") return null;
  return (
    <ActionForm action={setFactStatusAction} className="inline-flex flex-col items-end">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value="verified" />
      <SubmitButton variant="secondary" size="sm" pending="Saving…">
        Mark verified
      </SubmitButton>
    </ActionForm>
  );
}

/** A small delete button that asks first. */
export function DeleteButton({ action, id, label = "Delete", confirm }: {
  action: (state: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  id: string;
  label?: string;
  confirm: string;
}) {
  return (
    <ActionForm action={action}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="danger" size="sm" confirm={confirm} pending="Deleting…">
        {label}
      </SubmitButton>
    </ActionForm>
  );
}
