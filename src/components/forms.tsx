"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/lib/action-result";
import { buttonClass, cx } from "./ui";

/** A submit button that shows progress while its form's action runs. */
export function SubmitButton({ children, pending: pendingLabel, variant = "primary", size = "md", name, value, confirm }: {
  children: ReactNode;
  pending?: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  name?: string;
  value?: string;
  /** Ask before submitting (for destructive actions). */
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      aria-busy={pending}
      className={buttonClass(variant, size)}
      onClick={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
    >
      {pending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
}

/**
 * A form bound to a server action that returns ActionResult. Shows the
 * action's message or error under the fields. React resets a form after its
 * action runs; when the action fails, the submitted values are put back so a
 * long paste isn't lost. Optionally stays cleared on success.
 */
export function ActionForm({ action, children, className, resetOnSuccess = false }: {
  action: (state: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const submitted = useRef<FormData | null>(null);
  const [state, formAction] = useActionState(async (previous: ActionResult | null, formData: FormData) => {
    submitted.current = formData;
    return action(previous, formData);
  }, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const form = ref.current;
    if (!form || !state) return;
    if (state.ok) {
      if (resetOnSuccess) form.reset();
      return;
    }
    const data = submitted.current;
    if (data) restoreValues(form, data);
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      <ActionMessage state={state} />
    </form>
  );
}

function restoreValues(form: HTMLFormElement, data: FormData) {
  for (const element of Array.from(form.elements)) {
    if (element instanceof HTMLTextAreaElement) {
      const value = data.get(element.name);
      if (typeof value === "string") element.value = value;
    } else if (element instanceof HTMLSelectElement) {
      const value = data.get(element.name);
      if (typeof value === "string") element.value = value;
    } else if (element instanceof HTMLInputElement && element.name) {
      if (element.type === "checkbox" || element.type === "radio") {
        element.checked = data.getAll(element.name).includes(element.value);
      } else if (!["file", "hidden", "submit", "button", "password"].includes(element.type)) {
        const value = data.get(element.name);
        if (typeof value === "string") element.value = value;
      }
    }
  }
}

export function ActionMessage({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  const text = state.ok ? state.message : state.error;
  if (!text) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={cx("mt-2 text-sm", state.ok ? "text-ok" : "text-bad")}>
      {text}
    </p>
  );
}
