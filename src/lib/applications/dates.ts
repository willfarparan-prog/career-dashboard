import { localDay } from "@/lib/time";

/*
 * Day-level date helpers. Next-action dates and deadlines are stored as text
 * ("YYYY-MM-DD") and compared as plain calendar days. "Today" is the owner's
 * day (APP_TIME_ZONE, see src/lib/time.ts), not UTC's.
 */

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/** "YYYY-MM-DD" for a moment, in UTC. For day arithmetic; use todayIso() for "today". */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today's date ("YYYY-MM-DD") in the owner's time zone. */
export function todayIso(now = new Date()): string {
  return localDay(now);
}

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDay(date);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** A stored day ("2026-10-03", "2026-10-03T…", or a parseable date like "Oct 3, 2026") as "YYYY-MM-DD", or null. */
export function parseDay(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  const match = ISO_DAY.exec(text);
  if (match) {
    const [, y, m, d] = match;
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    return date.getUTCMonth() === Number(m) - 1 && date.getUTCDate() === Number(d) ? `${y}-${m}-${d}` : null;
  }
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) return null;
  const date = new Date(parsed);
  // Date.parse reads "Oct 3, 2026" as local midnight; keep the calendar day it names.
  return isoDay(new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())));
}

export function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function startOfUtcMonth(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export type DueState = "overdue" | "today" | "soon" | "later";

/** How close a next-action date is. `soonDays` is the "coming up" window. */
export function dueState(day: string | null | undefined, today: string, soonDays = 7): DueState | null {
  const parsed = parseDay(day);
  if (!parsed) return null;
  const diff = daysBetween(today, parsed);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  return diff <= soonDays ? "soon" : "later";
}

/**
 * The submitted date from a form's "YYYY-MM-DD" field: today means now; an
 * earlier day means noon UTC that day (which is that same day across the
 * Americas). Null when blank or invalid.
 */
export function submittedAtFromDay(day: string, now = new Date()): Date | null {
  const parsed = parseDay(day);
  if (!parsed) return null;
  if (parsed === todayIso(now)) return now;
  return new Date(`${parsed}T12:00:00Z`);
}
