/** What every server action returns to the form that called it. */
export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

export const ok = (message?: string): ActionResult => ({ ok: true, message });
export const fail = (error: string): ActionResult => ({ ok: false, error });

/** Reads a trimmed string field from a form. */
export function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Reads an optional integer field; blank or invalid becomes null. */
export function intField(formData: FormData, name: string): number | null {
  const raw = field(formData, name).replace(/[$,\s]/g, "");
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.round(value) : null;
}

/** Splits a comma- or newline-separated field into a clean list. */
export function listField(formData: FormData, name: string): string[] {
  return field(formData, name)
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
