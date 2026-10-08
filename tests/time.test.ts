import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { formatDate } from "@/components/ui";
import { submittedAtFromDay, todayIso } from "@/lib/applications/dates";
import { letterDate } from "@/lib/export/common";
import { appTimeZone, displayZone, localDay, localHour, startOfLocalDay } from "@/lib/time";

/* "Today" is the owner's day, not UTC's: the server runs in UTC, the owner in California. */

const saved = process.env.APP_TIME_ZONE;
afterEach(() => {
  if (saved === undefined) delete process.env.APP_TIME_ZONE;
  else process.env.APP_TIME_ZONE = saved;
});

// 7:30 pm Pacific on Oct 7 is already Oct 8 in UTC.
const EVENING = new Date("2026-10-08T02:30:00Z");

test("an evening in California is still today, not tomorrow", () => {
  delete process.env.APP_TIME_ZONE;
  assert.equal(appTimeZone(), "America/Los_Angeles");
  assert.equal(EVENING.toISOString().slice(0, 10), "2026-10-08");
  assert.equal(localDay(EVENING), "2026-10-07");
  assert.equal(todayIso(EVENING), "2026-10-07");
  assert.equal(localHour(EVENING), 19);
  assert.equal(letterDate(EVENING), "October 7, 2026");
  // Marking applied "today" that evening keeps the real moment.
  assert.equal(submittedAtFromDay("2026-10-07", EVENING), EVENING);
});

test("APP_TIME_ZONE overrides the default; an unknown zone falls back", () => {
  process.env.APP_TIME_ZONE = "America/New_York";
  assert.equal(localDay(EVENING), "2026-10-07");
  assert.equal(localHour(EVENING), 22);
  process.env.APP_TIME_ZONE = "UTC";
  assert.equal(todayIso(EVENING), "2026-10-08");
  process.env.APP_TIME_ZONE = "Mars/Olympus_Mons";
  assert.equal(appTimeZone(), "America/Los_Angeles");
});

test("a local day starts at local midnight, across daylight saving", () => {
  delete process.env.APP_TIME_ZONE;
  assert.equal(startOfLocalDay("2026-10-01").toISOString(), "2026-10-01T07:00:00.000Z", "PDT");
  assert.equal(startOfLocalDay("2026-12-01").toISOString(), "2026-12-01T08:00:00.000Z", "PST");
  assert.equal(startOfLocalDay("2026-10-01", "UTC").toISOString(), "2026-10-01T00:00:00.000Z");
});

test("day-only values print as written; moments print in the owner's zone", () => {
  delete process.env.APP_TIME_ZONE;
  assert.equal(displayZone("2026-10-08"), "UTC");
  assert.equal(displayZone(EVENING), "America/Los_Angeles");
  assert.equal(formatDate("2026-10-08"), "Oct 8, 2026", "a deadline is a calendar day");
  assert.equal(formatDate(EVENING), "Oct 7, 2026", "a timestamp is the owner's day");
  assert.equal(formatDate(EVENING.toISOString()), "Oct 7, 2026");
});
