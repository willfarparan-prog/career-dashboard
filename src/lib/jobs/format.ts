import type { CareerPath, RequirementKind } from "@/db/schema";

/* Display labels and small formatters for jobs. Pure, so pages and tests share them. */

export const REMOTE_TYPES = ["remote", "hybrid", "onsite", "unknown"] as const;
export type RemoteType = (typeof REMOTE_TYPES)[number];

export const COMPANY_SIZES = ["startup", "mid", "enterprise", "unknown"] as const;
export type CompanySize = (typeof COMPANY_SIZES)[number];

export const POSTING_STATUSES = ["active", "stale", "closed"] as const;
export type PostingStatus = (typeof POSTING_STATUSES)[number];

export const REMOTE_LABELS: Record<RemoteType, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
  unknown: "Work setup not stated",
};

export const COMPANY_SIZE_LABELS: Record<CompanySize, string> = {
  startup: "Startup",
  mid: "Mid-size",
  enterprise: "Enterprise",
  unknown: "Not sure",
};

export const POSTING_STATUS_LABELS: Record<PostingStatus, string> = {
  active: "Active",
  stale: "Stale",
  closed: "Closed",
};

export const CAREER_PATH_LABELS: Record<CareerPath, string> = {
  customer_success: "Customer success",
  implementation: "Implementation",
  account_management: "Account management",
  employer_wellbeing: "Employer wellbeing",
  other: "Other",
};

export const KIND_LABELS: Record<RequirementKind, string> = {
  must: "Must-haves",
  preferred: "Preferred",
  responsibility: "Responsibilities",
  tool: "Tools",
  screening: "Screening questions",
};

export const KIND_SINGULAR: Record<RequirementKind, string> = {
  must: "Must-have",
  preferred: "Preferred",
  responsibility: "Responsibility",
  tool: "Tool",
  screening: "Screening",
};

/** Requirement kinds that get evidence matching, in display order. */
export const MATCHED_KINDS = ["must", "preferred", "responsibility", "tool"] as const satisfies readonly RequirementKind[];

const usd = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** "$80,000 – $95,000", "$80,000+", or the posting's own wording. Empty when unknown. */
export function formatComp(job: { compMin: number | null; compMax: number | null; compText: string }): string {
  const { compMin, compMax } = job;
  if (compMin != null && compMax != null) return compMin === compMax ? usd(compMin) : `${usd(compMin)} – ${usd(compMax)}`;
  if (compMin != null) return `${usd(compMin)}+`;
  if (compMax != null) return `Up to ${usd(compMax)}`;
  return job.compText.trim();
}

export function jobTitle(job: { title: string }) {
  return job.title.trim() || "Untitled role";
}

export function jobCompany(job: { company: string }) {
  return job.company.trim() || "Company not set";
}

/** Today's date as YYYY-MM-DD in UTC. */
export function todayIso(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value: string) {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string) {
  return UUID.test(value);
}

/** Lowercase, punctuation-free, single-spaced. Used for duplicate checks and loose matching. */
export function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
