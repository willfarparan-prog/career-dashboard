"use client";

import { useFormStatus } from "react-dom";

/** A select that saves its form as soon as it changes. */
export function AutoSubmitSelect({ name, defaultValue, options, label }: {
  name: string;
  defaultValue: string;
  options: { value: string; label: string }[];
  /** Accessible name (the select has no visible label). */
  label: string;
}) {
  const { pending } = useFormStatus();
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      aria-label={label}
      aria-busy={pending}
      className={`max-w-full rounded-md border border-input bg-card px-2 py-1 text-xs text-foreground focus:outline-2 focus:outline-offset-1 focus:outline-ring ${pending ? "opacity-60" : ""}`}
      onChange={(event) => event.currentTarget.form?.requestSubmit()}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
