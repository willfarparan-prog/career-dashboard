import type { FactStatus, FitWeights, Metric } from "@/db/schema";
import { field, listField } from "@/lib/action-result";
import type { AchievementInput } from "./achievements";
import type { CredentialInput } from "./credentials";
import { isFactKind, type FactKind } from "./facts";
import { FIT_WEIGHT_KEYS, isCareerPath, isFactStatus, type CredentialKind, type SkillCategory } from "./labels";
import type { ContactInput, SearchSettingsInput } from "./profile";
import type { RoleInput } from "./roles";
import type { SkillInput } from "./skills";
import { CareerInputError } from "./util";

/* FormData → input objects for the career logic. Validation lives with the logic; these only read fields. */

const checked = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return value === "on" || value === "true" || value === "1";
};

const factStatus = (formData: FormData, fallback: FactStatus = "verified"): FactStatus => {
  const value = field(formData, "factStatus");
  return isFactStatus(value) ? value : fallback;
};

/** "85000", "$85,000" or "85k" → 85000. Blank → null. */
export function parseAnnualUsd(raw: string): number | null {
  const text = raw.replace(/[$,\s]|usd/gi, "");
  if (!text) return null;
  const match = /^(\d+(?:\.\d+)?)(k)?$/i.exec(text);
  if (!match) throw new CareerInputError("Enter the minimum as a yearly amount in US dollars, like 85000.");
  return Math.round(Number(match[1]) * (match[2] ? 1000 : 1));
}

export function parseContactForm(formData: FormData): ContactInput {
  return {
    fullName: field(formData, "fullName"),
    headline: field(formData, "headline"),
    email: field(formData, "email"),
    phone: field(formData, "phone"),
    location: field(formData, "location"),
    links: field(formData, "links")
      .split(/[\s,]+/)
      .filter(Boolean),
  };
}

export function parseSearchSettingsForm(formData: FormData): SearchSettingsInput {
  const fitWeights = {} as FitWeights;
  for (const key of FIT_WEIGHT_KEYS) {
    const raw = field(formData, `weight_${key}`);
    fitWeights[key] = raw === "" ? 3 : Number(raw);
  }
  return {
    targetRoles: formData.getAll("targetRoles").filter(isCareerPath),
    targetLocations: listField(formData, "targetLocations"),
    remoteOk: checked(formData, "remoteOk"),
    compMin: parseAnnualUsd(field(formData, "compMin")),
    fitWeights,
  };
}

export function parseRoleForm(formData: FormData): RoleInput {
  return {
    employer: field(formData, "employer"),
    title: field(formData, "title"),
    start: field(formData, "start"),
    end: field(formData, "end"),
    isCurrent: checked(formData, "isCurrent"),
    location: field(formData, "location"),
    employmentType: field(formData, "employmentType"),
    summary: field(formData, "summary"),
    isSaas: checked(formData, "isSaas"),
    factStatus: factStatus(formData),
  };
}

export function parseCredentialForm(formData: FormData): CredentialInput {
  return {
    kind: field(formData, "kind") as CredentialKind,
    name: field(formData, "name"),
    issuer: field(formData, "issuer"),
    date: field(formData, "date"),
    detail: field(formData, "detail"),
    factStatus: factStatus(formData),
  };
}

export function parseSkillForm(formData: FormData): SkillInput {
  return {
    name: field(formData, "name"),
    category: (field(formData, "category") || "skill") as SkillCategory,
    factStatus: factStatus(formData),
    note: field(formData, "note"),
  };
}

/** Metric rows arrive as parallel lists (metricLabel[], metricValue[], …). Blank rows are dropped later. */
function parseMetricRows(formData: FormData): Metric[] {
  const all = (name: string) => formData.getAll(name).map((value) => (typeof value === "string" ? value.trim() : ""));
  const labels = all("metricLabel");
  const values = all("metricValue");
  const units = all("metricUnit");
  const statuses = all("metricStatus");
  return labels.map((label, i) => ({
    label,
    value: values[i] ?? "",
    unit: units[i] || null,
    status: isFactStatus(statuses[i]) ? statuses[i] : "verified",
  }));
}

export function parseAchievementForm(formData: FormData): AchievementInput {
  const roleId = field(formData, "roleId");
  return {
    roleId: roleId || null,
    headline: field(formData, "headline"),
    action: field(formData, "action"),
    audience: field(formData, "audience"),
    scale: field(formData, "scale"),
    collaborators: field(formData, "collaborators"),
    tools: listField(formData, "tools"),
    outcome: field(formData, "outcome"),
    metrics: parseMetricRows(formData),
    tags: listField(formData, "tags"),
    factStatus: factStatus(formData),
    evidenceNote: field(formData, "evidenceNote"),
    missingMetrics: listField(formData, "missingMetrics"),
  };
}

/** The quick fact-status buttons: which item, and the new status. */
export function parseFactForm(formData: FormData): { kind: FactKind; id: string; status: FactStatus } {
  const kind = field(formData, "kind");
  const status = field(formData, "status");
  if (!isFactKind(kind) || !isFactStatus(status)) throw new CareerInputError("That change isn't possible.");
  return { kind, id: field(formData, "id"), status };
}
