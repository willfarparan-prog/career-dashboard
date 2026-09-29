/** A problem with what the owner entered; its message is safe to show in the form. */
export class CareerInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CareerInputError";
  }
}

/** The message a server action shows for an error thrown by career logic. */
export function careerErrorMessage(error: unknown, fallback = "Couldn't save that. Please try again."): string {
  if (error instanceof CareerInputError) return error.message;
  console.error(error);
  return fallback;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids from forms and URLs are checked before they reach a uuid column (Postgres rejects bad syntax loudly). */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Trims, drops blanks and removes case-insensitive duplicates, keeping the first spelling. */
export function cleanList(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const item = raw.trim().replace(/\s+/g, " ");
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Tags are stored lowercase so filters and grouping match reliably. */
export function cleanTags(items: readonly string[]): string[] {
  return cleanList(items.map((tag) => tag.toLowerCase()));
}

export const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Throws a CareerInputError when a required text field is blank. */
export function required(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new CareerInputError(message);
  return trimmed;
}
