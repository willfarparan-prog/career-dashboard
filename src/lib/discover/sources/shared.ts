import type { FetchLike, SearchSpec } from "../types";

/*
 * Helpers every adapter shares: HTTP with clear errors, tolerant field
 * coercion, dates, freshness and salary formatting. Keys are read from
 * process.env at call time and never put into messages.
 */

const TIMEOUT_MS = 20_000;
const DAY_MS = 86_400_000;

/** An adapter failure; `requests` is what it cost against the quota before failing. */
export class SourceError extends Error {
  requests: number;
  constructor(message: string, requests = 0) {
    super(message);
    this.name = "SourceError";
    this.requests = requests;
  }
}

export const defaultFetch: FetchLike = (input, init) => fetch(input, init);

/** Trimmed env var, or "" when unset. */
export function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function requireEnv(label: string, names: string[]): string[] {
  const missing = names.filter((name) => !env(name));
  if (missing.length) throw new SourceError(`${label} isn't set up: add ${missing.join(" and ")} to the environment.`);
  return names.map(env);
}

const STATUS_HINTS: Record<number, string> = {
  400: "bad request",
  401: "check the API key",
  403: "check the API key or plan",
  404: "not found",
  429: "rate limited",
};

/** Replaces any configured secret that slipped into a message. */
export function redact(message: string, secrets: string[]): string {
  let out = message;
  for (const secret of secrets) if (secret && secret.length >= 4) out = out.split(secret).join("[redacted]");
  return out;
}

/** Fetches once; throws a SourceError naming the source on network failure or a non-2xx status. */
export async function request(fetchImpl: FetchLike, label: string, url: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal: init.signal ?? AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "network error";
    throw new SourceError(`${label} couldn't be reached (${reason}).`, 1);
  }
  if (!response.ok) {
    const hint = STATUS_HINTS[response.status] ?? (response.status >= 500 ? "server error" : "");
    throw new SourceError(`${label} returned ${response.status}${hint ? ` (${hint})` : ""}.`, 1);
  }
  return response;
}

export async function readJson(response: Response, label: string, requests: number): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new SourceError(`${label} sent a response that isn't valid JSON.`, requests);
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

export function str(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.replace(/[,$\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value);
}

/** ISO strings (UTC when no zone is given), RFC 822 dates, or unix seconds/milliseconds. */
export function parseDate(value: unknown): Date | null {
  let ms: number;
  if (typeof value === "number" && Number.isFinite(value)) {
    ms = value < 1e12 ? value * 1000 : value;
  } else if (typeof value === "string" && value.trim()) {
    const text = value.trim();
    if (/^\d+(\.\d+)?$/.test(text)) return parseDate(Number(text));
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text) ? `${text}Z` : text;
    ms = Date.parse(iso);
  } else {
    return null;
  }
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms);
}

/** Unknown dates are kept; known ones must fall within the search's window. */
export function isFresh(postedAt: Date | null, maxAgeDays: number, now: Date): boolean {
  if (!postedAt) return true;
  return now.getTime() - postedAt.getTime() <= maxAgeDays * DAY_MS;
}

export function mentionsRemote(...texts: string[]): boolean {
  return texts.some((t) => /\b(remote|work from home|wfh|work from anywhere|telecommut\w*)\b/i.test(t));
}

/** Search words plus "remote" for remote-only searches (or location "Remote"), without saying it twice. */
export function queryWithRemote(spec: SearchSpec): string {
  const query = spec.query.trim();
  const wantsRemote = spec.remoteOnly || /^remote$/i.test(spec.location.trim());
  return wantsRemote && !/\bremote\b/i.test(query) ? `${query} remote` : query;
}

/** The location to send, or "" when the search is remote-only or the location just says remote. */
export function placeFor(spec: SearchSpec): string {
  const location = spec.location.trim();
  if (spec.remoteOnly || !location || /^(remote|anywhere)$/i.test(location)) return "";
  return location;
}

export type PayPeriod = "hour" | "day" | "week" | "month" | "year";

const PER_YEAR: Record<PayPeriod, number> = { hour: 2080, day: 260, week: 52, month: 12, year: 1 };
const PERIOD_SUFFIX: Record<PayPeriod, string> = { hour: "an hour", day: "a day", week: "a week", month: "a month", year: "a year" };
const CURRENCY_SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", CAD: "CA$", AUD: "A$" };

export function toPeriod(value: unknown): PayPeriod | null {
  const text = str(value).toLowerCase();
  if (/^(hour|hourly|hr)/.test(text)) return "hour";
  if (/^(day|daily)/.test(text)) return "day";
  if (/^(week|weekly)/.test(text)) return "week";
  if (/^(month|monthly)/.test(text)) return "month";
  if (/^(year|yearly|annual|annum)/.test(text)) return "year";
  return null;
}

/** Yearly equivalent (hour ×2080, month ×12…), rounded to whole dollars. */
export function annualize(value: number | null, period: PayPeriod): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * PER_YEAR[period]);
}

function amount(value: number, symbol: string): string {
  if (value >= 1000) {
    const thousands = Math.round(value / 100) / 10;
    return `${symbol}${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}k`;
  }
  return `${symbol}${Number.isInteger(value) ? value : value.toFixed(2)}`;
}

/** "$85k–$100k a year", "$25–$30 an hour", "$85k+ a year", "Up to $30 an hour". */
export function formatSalary(min: number | null, max: number | null, period: PayPeriod, currency = "USD"): string {
  const code = str(currency).toUpperCase() || "USD";
  const symbol = CURRENCY_SYMBOLS[code] ?? `${code} `;
  const low = min != null && min > 0 ? min : null;
  const high = max != null && max > 0 ? max : null;
  let range: string;
  if (low != null && high != null) range = low === high ? amount(low, symbol) : `${amount(Math.min(low, high), symbol)}–${amount(Math.max(low, high), symbol)}`;
  else if (low != null) range = `${amount(low, symbol)}+`;
  else if (high != null) range = `Up to ${amount(high, symbol)}`;
  else return "";
  return `${range} ${PERIOD_SUFFIX[period]}`;
}

/** Yearly min/max in USD from free text like "$60k - $80k" or "$40/hour"; null when unclear or not dollars. */
export function parseSalaryText(text: string): { min: number | null; max: number | null } {
  const none = { min: null, max: null };
  const lower = text.toLowerCase().replace(/,/g, "");
  if (!lower.trim()) return none;
  if (/[€£¥]|\b(eur|gbp|inr|cad|aud|chf|jpy|brl|mxn|pln)\b/.test(lower)) return none;
  const matches = [...lower.matchAll(/(\d+(?:\.\d+)?)\s*(k\b)?/g)];
  const hasK = matches.some((m) => m[2]);
  let values = matches.map((m) => Number(m[1]) * (m[2] ? 1000 : 1)).filter((n) => n > 0);
  if (hasK) values = values.map((n) => (n < 1000 ? n * 1000 : n));
  if (!values.length) return none;
  const period: PayPeriod = /(hour|\/hr\b|\bhr\b|\/h\b)/.test(lower)
    ? "hour"
    : /month|\/mo\b/.test(lower)
      ? "month"
      : Math.max(...values) < 500
        ? "hour"
        : "year";
  const yearly = values.slice(0, 2).map((v) => annualize(v, period) ?? 0);
  if (yearly.some((v) => v < 10_000 || v > 2_000_000)) return none;
  return { min: Math.min(...yearly), max: Math.max(...yearly) };
}

/** Days back as JSearch's date_posted bucket. */
export function datePostedBucket(maxAgeDays: number): "today" | "3days" | "week" | "month" {
  if (maxAgeDays <= 1) return "today";
  if (maxAgeDays <= 3) return "3days";
  if (maxAgeDays <= 7) return "week";
  return "month";
}
