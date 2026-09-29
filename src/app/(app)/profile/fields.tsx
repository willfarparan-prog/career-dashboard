import type { ReactNode } from "react";
import { FACT_OPTIONS, cx } from "@/components/ui";
import type { FactStatus } from "@/db/schema";

/* Plain labelled inputs for the career forms (server-safe; used inside StickyForm/ActionForm). */

type Common = { label: string; name: string; hint?: ReactNode; className?: string };

export function TextField({ label, name, hint, className, defaultValue, placeholder, type = "text", required, inputMode, autoComplete }: Common & {
  defaultValue?: string | number | null;
  placeholder?: string;
  type?: "text" | "email" | "tel" | "url";
  required?: boolean;
  inputMode?: "text" | "numeric" | "decimal" | "email" | "tel" | "url";
  autoComplete?: string;
}) {
  return (
    <label className={cx("field", className)}>
      <span>{label}</span>
      <input
        className="input"
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        required={required}
        inputMode={inputMode}
        autoComplete={autoComplete ?? "off"}
      />
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function TextArea({ label, name, hint, className, defaultValue, placeholder, rows = 3 }: Common & { defaultValue?: string; placeholder?: string; rows?: number }) {
  return (
    <label className={cx("field", className)}>
      <span>{label}</span>
      <textarea className="input" name={name} defaultValue={defaultValue ?? ""} placeholder={placeholder} rows={rows} />
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function SelectField({ label, name, hint, className, defaultValue, options }: Common & {
  defaultValue?: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <label className={cx("field", className)}>
      <span>{label}</span>
      <select className="input" name={name} defaultValue={defaultValue}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function CheckboxField({ label, name, hint, className, defaultChecked, value }: Common & { defaultChecked?: boolean; value?: string }) {
  return (
    <label className={cx("flex items-start gap-2 text-sm", className)}>
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" />
      <span className="min-w-0">
        <span className="font-medium">{label}</span>
        {hint ? <small className="block text-xs text-muted-foreground">{hint}</small> : null}
      </span>
    </label>
  );
}

export function FactStatusField({ defaultValue = "verified", name = "factStatus", label = "Fact status", className }: { defaultValue?: FactStatus; name?: string; label?: string; className?: string }) {
  return <SelectField label={label} name={name} defaultValue={defaultValue} options={FACT_OPTIONS} className={className} hint="Private facts stay out of Claude unless you allow it in Settings." />;
}

/** A disclosure used for inline edit/add forms. */
export function Disclosure({ summary, children, open, className }: { summary: ReactNode; children: ReactNode; open?: boolean; className?: string }) {
  return (
    <details open={open} className={cx("group", className)}>
      <summary className="cursor-pointer list-none text-sm font-medium text-primary select-none hover:underline [&::-webkit-details-marker]:hidden">
        <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>
          ›
        </span>{" "}
        {summary}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
