import type { ApplyOption, LeadSource } from "@/db/schema";

/** What a saved search asks every source for. */
export type SearchSpec = {
  query: string;
  /** Free text, e.g. "Tampa, FL"; empty = anywhere. */
  location: string;
  remoteOnly: boolean;
  maxAgeDays: number;
};

/** One posting, normalized from any source, before it's stored as a lead. */
export type NormalizedLead = {
  source: LeadSource;
  externalId: string;
  title: string;
  company: string;
  location: string;
  isRemote: boolean;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryText: string;
  /** Where it was published: "LinkedIn", "Indeed", "Glassdoor" (JSearch) or the board's name. */
  publisher: string;
  /** Link to open: the official apply page when the source gives one. */
  url: string;
  applyOptions: ApplyOption[];
  /** Plain text (HTML stripped), capped at 60,000 characters. */
  description: string;
  postedAt: Date | null;
};

export type SourcePolicy = {
  /** Don't call the same source for the same query more often than this. */
  minIntervalMinutes: number;
  /** Request budget per calendar month (UTC), when the free tier has one. */
  monthlyQuota?: number;
  /** Request budget per UTC day. */
  dailyQuota?: number;
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type SourceAdapter = {
  id: LeadSource;
  label: string;
  /** One line for the UI, e.g. "Google Jobs — LinkedIn, Indeed, Glassdoor and company sites". */
  description: string;
  /** Required credit line and link, shown next to every lead from this source. */
  attribution: { text: string; href: string } | null;
  /** Env vars this source needs (empty when none). */
  envVars: string[];
  configured: () => boolean;
  policy: SourcePolicy;
  /** Remote-only boards skip searches that aren't open to remote work. */
  remoteOnly: boolean;
  fetch: (spec: SearchSpec, fetchImpl?: FetchLike) => Promise<{ leads: NormalizedLead[]; requests: number }>;
};

export type SourceRunResult = {
  source: LeadSource;
  searchId: string;
  status: "ok" | "error" | "skipped";
  found: number;
  added: number;
  requests: number;
  message: string;
};

export type RefreshSummary = { runs: SourceRunResult[]; added: number; found: number };
