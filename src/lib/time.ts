/*
 * The owner's calendar. The server runs in UTC, so "today", greetings and the
 * dates printed for timestamps follow APP_TIME_ZONE (an IANA name, default
 * America/Los_Angeles); otherwise every evening would already be "tomorrow".
 * Day-only values ("YYYY-MM-DD": deadlines, next-action dates) are calendar
 * days and are never shifted. Source quotas and the Claude budget still reset
 * at midnight UTC, because that is when the vendors' counters reset.
 */

export const DEFAULT_TIME_ZONE = "America/Los_Angeles";

function validZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** APP_TIME_ZONE when it names a real zone, else the default. */
export function appTimeZone(): string {
  const zone = process.env.APP_TIME_ZONE?.trim();
  return zone && validZone(zone) ? zone : DEFAULT_TIME_ZONE;
}

/** The calendar day ("YYYY-MM-DD") that `at` falls on in the owner's time zone. */
export function localDay(at: Date, timeZone = appTimeZone()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** The hour (0–23) of `at` in the owner's time zone. */
export function localHour(at: Date, timeZone = appTimeZone()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(at)) % 24;
}

/** The moment a calendar day ("YYYY-MM-DD") starts in the owner's time zone. */
export function startOfLocalDay(day: string, timeZone = appTimeZone()): Date {
  const guess = new Date(`${day}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(guess);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const offset = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute")) - guess.getTime();
  return new Date(guess.getTime() - offset);
}

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The time zone to print a value in: day-only strings are calendar days
 * (read as UTC midnight, so print them in UTC); moments use the owner's zone.
 */
export function displayZone(value: Date | string): string {
  return typeof value === "string" && DAY_ONLY.test(value.trim()) ? "UTC" : appTimeZone();
}
