"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { ActionMessage } from "@/components/forms";
import { buttonClass } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";

/*
 * Like ActionForm, but the fields keep what the owner typed when the action
 * returns an error. (A plain <form action> is reset by React after every
 * submission, which would wipe a long form or a pasted resume.)
 */

const Pending = createContext(false);

export function StickyForm({ action, children, className, resetOnSuccess = false }: {
  action: (state: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, dispatch, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state?.ok) ref.current?.reset();
  }, [state, resetOnSuccess]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(() => dispatch(formData));
  }

  return (
    <form ref={ref} onSubmit={onSubmit} className={className} aria-busy={pending}>
      <Pending.Provider value={pending}>{children}</Pending.Provider>
      {pending ? null : <ActionMessage state={state} />}
    </form>
  );
}

/** Submit button for StickyForm; shows progress while the action runs. */
export function StickySubmit({ children, pending: pendingLabel, variant = "primary", size = "md", name, value }: {
  children: ReactNode;
  pending?: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  name?: string;
  value?: string;
}) {
  const pending = useContext(Pending);
  return (
    <button type="submit" name={name} value={value} disabled={pending} aria-busy={pending} className={buttonClass(variant, size)}>
      {pending ? (pendingLabel ?? "Saving…") : children}
    </button>
  );
}

/** Text shown only while the surrounding StickyForm is working (e.g. "Claude is reading…"). */
export function WhilePending({ children }: { children: ReactNode }) {
  const pending = useContext(Pending);
  return pending ? <>{children}</> : null;
}
