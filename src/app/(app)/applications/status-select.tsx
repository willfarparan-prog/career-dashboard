"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { STATUS_OPTIONS, cx } from "@/components/ui";
import type { ApplicationStatus } from "@/db/schema";
import { updateStatusAction } from "./actions";

/**
 * Quick status change: saves as soon as a new status is picked. "Applied" is
 * offered only once the application was marked applied (which freezes the
 * files sent); before that, the job page's "Mark as applied" form does it.
 */
export function StatusSelect({ applicationId, status, frozen, label = "Status", compact = false }: {
  applicationId: string;
  status: ApplicationStatus;
  frozen: boolean;
  label?: string;
  compact?: boolean;
}) {
  const [state, action, pending] = useActionState(updateStatusAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  const id = useId();
  const options = STATUS_OPTIONS.filter((option) => option.value !== "applied" || frozen || status === "applied");

  // A refused change puts the select back on the saved status.
  useEffect(() => {
    if (state && !state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="min-w-0">
      <input type="hidden" name="applicationId" value={applicationId} />
      <label htmlFor={id} className={compact ? "sr-only" : "mb-1 block text-xs font-medium text-muted-foreground"}>
        {label}
      </label>
      <select
        id={id}
        key={status}
        name="status"
        defaultValue={status}
        disabled={pending}
        aria-busy={pending}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className={cx("input", compact && "py-1 text-xs")}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {state && !state.ok ? (
        <p role="alert" className="mt-1 text-xs text-bad">
          {state.error}
        </p>
      ) : null}
      <noscript>
        <button type="submit" className="mt-1 text-xs underline">
          Save status
        </button>
      </noscript>
    </form>
  );
}
