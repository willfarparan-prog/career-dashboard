import { CAREER_PATHS, FACT_STATUSES, type CareerPath, type FactStatus, type FitWeights } from "@/db/schema";

/* Labels and small validators shared by the career pages and their logic. Safe to import anywhere. */

export const TARGET_ROLE_LABELS: Record<CareerPath, string> = {
  customer_success: "Customer success",
  implementation: "Implementation",
  account_management: "Account management",
  employer_wellbeing: "Employer wellbeing",
  strength_conditioning: "Strength & conditioning / tactical performance",
  other: "Other",
};

export const TARGET_ROLE_OPTIONS = CAREER_PATHS.map((value) => ({ value, label: TARGET_ROLE_LABELS[value] }));

export const CREDENTIAL_KINDS = ["education", "certification", "award"] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];
export const CREDENTIAL_KIND_LABELS: Record<CredentialKind, string> = {
  education: "Education",
  certification: "Certification",
  award: "Award",
};

export const SKILL_CATEGORIES = ["skill", "tool", "domain"] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];
export const SKILL_CATEGORY_LABELS: Record<SkillCategory, string> = {
  skill: "Skill",
  tool: "Tool",
  domain: "Domain",
};

export const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contract", "Freelance", "Internship", "Volunteer"] as const;

export const FIT_WEIGHT_KEYS = ["compensation", "location", "fit", "companySize", "growth", "interest"] as const satisfies ReadonlyArray<keyof FitWeights>;
export const FIT_WEIGHT_LABELS: Record<keyof FitWeights, string> = {
  compensation: "Compensation",
  location: "Location",
  fit: "Role fit",
  companySize: "Company size",
  growth: "Growth",
  interest: "Interest",
};
export const DEFAULT_FIT_WEIGHTS: FitWeights = { compensation: 3, location: 3, fit: 3, companySize: 3, growth: 3, interest: 3 };

/** Numbers that would usually strengthen an achievement. Prompts only — never filled in for the owner. */
export const DEFAULT_METRIC_PROMPTS = ["participation", "retention", "referrals", "revenue", "time saved"];

export function isFactStatus(value: unknown): value is FactStatus {
  return typeof value === "string" && (FACT_STATUSES as readonly string[]).includes(value);
}

export function isCareerPath(value: unknown): value is CareerPath {
  return typeof value === "string" && (CAREER_PATHS as readonly string[]).includes(value);
}

export function isCredentialKind(value: unknown): value is CredentialKind {
  return typeof value === "string" && (CREDENTIAL_KINDS as readonly string[]).includes(value);
}

export function isSkillCategory(value: unknown): value is SkillCategory {
  return typeof value === "string" && (SKILL_CATEGORIES as readonly string[]).includes(value);
}

const MONTH_OR_YEAR = /^\d{4}(-(0[1-9]|1[0-2]))?$/;

/** Accepts "", "YYYY" or "YYYY-MM" (a single-digit month is padded). Returns null when invalid. */
export function normalizeMonth(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const padded = trimmed.replace(/^(\d{4})[-/](\d)$/, "$1-0$2").replace(/^(\d{4})\/(\d{2})$/, "$1-$2");
  return MONTH_OR_YEAR.test(padded) ? padded : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2021-03" → "Mar 2021"; "2021" stays "2021". */
export function formatMonth(value: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return value;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${month} ${match[1]}` : value;
}

export function formatRange(start: string, end: string, isCurrent: boolean): string {
  const from = start ? formatMonth(start) : "";
  const to = isCurrent ? "Present" : end ? formatMonth(end) : "";
  if (!from && !to) return "";
  return `${from || "?"} – ${to || "?"}`;
}
