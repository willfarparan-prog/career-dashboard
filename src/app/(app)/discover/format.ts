import { LEAD_SOURCES, LEAD_STATUSES, type DiscoverMode, type LeadSource, type LeadStatus } from "@/db/schema";
import type { SearchInput } from "@/lib/discover/searches";
import type { RefreshSummary } from "@/lib/discover/types";

/*
 * Pure helpers for the Discover page and its actions (no database, no
 * request). Tested in tests/discover-ui.test.ts.
 */

/** Names used when a source's adapter isn't registered (yet). */
export const SOURCE_LABELS: Record<LeadSource, string> = {
  jsearch: "JSearch (Google Jobs)",
  adzuna: "Adzuna",
  usajobs: "USAJOBS",
  himalayas: "Himalayas",
  remotive: "Remotive",
  wwr: "We Work Remotely",
};

export const MAX_AGE_OPTIONS = [
  { value: 1, label: "Last 24 hours" },
  { value: 3, label: "Last 3 days" },
  { value: 7, label: "Last 7 days" },
  { value: 14, label: "Last 14 days" },
  { value: 30, label: "Last 30 days" },
] as const;

/** "Good matches only" keeps leads at or above this score. */
export const GOOD_MATCH_SCORE = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isLeadSource(value: unknown): value is LeadSource {
  return typeof value === "string" && (LEAD_SOURCES as readonly string[]).includes(value);
}

/* ---------- Inbox filters (searchParams) ---------- */

export type InboxStatus = LeadStatus | "all";
export type InboxQuery = { status: InboxStatus; source: LeadSource | null; searchId: string | null; good: boolean; mode?: DiscoverMode; excluded?: boolean };

type Params = Record<string, string | string[] | undefined>;

function one(params: Params, key: string): string {
  const value = params[key];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/** Reads the inbox filters; anything unknown falls back to the default (New, all sources). */
export function parseInboxQuery(params: Params): InboxQuery {
  const status = one(params, "status");
  const source = one(params, "source");
  const searchId = one(params, "search");
  const good = one(params, "good");
  return {
    mode: one(params, "mode") === "explore" ? "explore" : "priority",
    excluded: one(params, "mode") === "explore" && one(params, "excluded") === "1",
    status: status === "all" || (LEAD_STATUSES as readonly string[]).includes(status) ? (status as InboxStatus) : "new",
    source: isLeadSource(source) ? source : null,
    searchId: UUID.test(searchId) ? searchId : null,
    good: good === "1" || good === "on" || good === "true",
  };
}

/** A /discover link with the given filters (defaults are left out of the URL). */
export function inboxHref(query: InboxQuery, change: Partial<InboxQuery> = {}): string {
  const next = { ...query, ...change };
  const params = new URLSearchParams();
  if (next.mode === "explore") params.set("mode", "explore");
  if (next.mode === "explore" && next.excluded) params.set("excluded", "1");
  if (next.status !== "new") params.set("status", next.status);
  if (next.source) params.set("source", next.source);
  if (next.searchId) params.set("search", next.searchId);
  if (next.good) params.set("good", "1");
  const qs = params.toString();
  return qs ? `/discover?${qs}` : "/discover";
}

/* ---------- Saved search form ---------- */

/** The saved-search form's fields, as the lib's SearchInput (validation happens there). */
export function searchInputFromForm(formData: FormData): SearchInput {
  const get = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value.trim() : "";
  };
  const days = Number(get("maxAgeDays") || 7);
  return {
    mode: get("mode") === "explore" ? "explore" : "priority",
    directionTerms: get("directionTerms").split("\n").map((s) => s.trim()).filter(Boolean),
    name: get("name"),
    query: get("query"),
    location: get("location"),
    remoteOnly: ["on", "true", "1"].includes(get("remoteOnly")),
    sources: formData.getAll("sources").filter((value): value is string => typeof value === "string"),
    maxAgeDays: Number.isFinite(days) ? days : 7,
  };
}

export function maxAgeLabel(days: number): string {
  return days === 1 ? "Posted in the last 24 hours" : `Posted in the last ${days} days`;
}

/* ---------- Display ---------- */

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "just now", "5 minutes ago", "yesterday", "2 days ago", "3 months ago". */
export function timeAgo(value: Date | string | null | undefined, now: Date = new Date()): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  const ms = now.getTime() - date.getTime();
  if (Number.isNaN(ms)) return "";
  if (ms < 60_000) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${plural(minutes, "minute")} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${plural(hours, "hour")} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${plural(Math.floor(days / 30), "month")} ago`;
  return `${plural(Math.floor(days / 365), "year")} ago`;
}

/** Only http(s) links from third-party data become hrefs. */
export function safeHref(url: string | null | undefined): string | null {
  const value = (url ?? "").trim();
  return /^https?:\/\/\S+$/i.test(value) ? value : null;
}

/** The start of a description, cut at a word boundary. */
export function previewText(text: string, max = 600): { text: string; truncated: boolean } {
  const clean = text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= max) return { text: clean, truncated: false };
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return { text: `${(space > max * 0.7 ? cut.slice(0, space) : cut).trimEnd()}…`, truncated: true };
}

const usd = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function salaryLabel(lead: { salaryText: string; salaryMin: number | null; salaryMax: number | null }): string {
  if (lead.salaryText.trim()) return lead.salaryText.trim();
  if (lead.salaryMin && lead.salaryMax && lead.salaryMin !== lead.salaryMax) return `${usd(lead.salaryMin)}–${usd(lead.salaryMax)}`;
  if (lead.salaryMin || lead.salaryMax) return usd((lead.salaryMin || lead.salaryMax) as number);
  return "";
}

export function placeLabel(lead: { location: string; isRemote: boolean }): string {
  const location = lead.location.trim();
  if (!lead.isRemote) return location;
  if (!location) return "Remote";
  return /remote/i.test(location) ? location : `${location} · Remote`;
}

export function scoreTone(score: number): "ok" | "warn" | "neutral" {
  return score >= 70 ? "ok" : score >= GOOD_MATCH_SCORE ? "warn" : "neutral";
}

/* ---------- Refresh summary ---------- */

function lowerFirst(value: string): string {
  return /^[A-Z][a-z]/.test(value) ? value[0].toLowerCase() + value.slice(1) : value;
}

/** "Himalayas returned 403 (…)" → "returned 403 (…)": the summary already names the source. */
function plainDetail(message: string): string {
  const match = /^.+?\s+((?:returned \d{3}|couldn't be reached)\b.*)$/.exec(message);
  return match ? match[1] : lowerFirst(message);
}

function listLabels(labels: string[]): string {
  return labels.length <= 1 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/**
 * "Found 23, 7 new. Skipped Adzuna: not set up." Sources skipped or failing
 * for the same reason are named together, once.
 */
export function refreshMessage(summary: RefreshSummary, labelOf: (id: LeadSource) => string): string {
  if (!summary.runs.length) return "Nothing ran. Add a saved search (or turn one on) and make sure a source is set up.";
  const groups = new Map<string, { status: "skipped" | "error"; detail: string; labels: string[] }>();
  for (const run of summary.runs) {
    if (run.status === "ok") continue;
    const message = run.message.trim().replace(/\.+$/, "");
    const detail = /^not set up\b/i.test(message) ? "not set up" : plainDetail(message);
    const key = `${run.status}|${detail}`;
    const group = groups.get(key) ?? { status: run.status, detail, labels: [] };
    const label = labelOf(run.source);
    if (!group.labels.includes(label)) group.labels.push(label);
    groups.set(key, group);
  }
  const notes = [...groups.values()].map(({ status, detail, labels }) =>
    status === "skipped" ? `Skipped ${listLabels(labels)}${detail ? `: ${detail}` : ""}.` : `${listLabels(labels)} failed${detail ? `: ${detail}` : ""}.`,
  );
  const shown = notes.slice(0, 4);
  if (notes.length > shown.length) shown.push(`(+${notes.length - shown.length} more)`);
  return [`Found ${summary.found}, ${summary.added} new.`, ...shown].join(" ");
}
