import type { EvidenceLabel, FitWeights, RequirementKind } from "@/db/schema";
import { COMPANY_SIZE_LABELS, normalizeText, type CompanySize, type RemoteType } from "./format";

/*
 * The fit score is a plain weighted average of six things the owner can see
 * and change. Each component scores 0–1; its share of the 0–100 total is its
 * weight over the sum of weights. Unknowns score 0.5 (neutral) so missing data
 * neither helps nor hurts. This is a personal ranking, not an ATS score.
 */

export const DEFAULT_FIT_WEIGHTS: FitWeights = { compensation: 3, location: 3, fit: 3, companySize: 3, growth: 3, interest: 3 };

export type FitKey = keyof FitWeights;

export const FIT_LABELS: Record<FitKey, string> = {
  compensation: "Pay",
  location: "Location",
  fit: "Evidence fit",
  companySize: "Company size",
  growth: "Growth",
  interest: "Interest",
};

const ORDER: FitKey[] = ["fit", "compensation", "location", "interest", "growth", "companySize"];

export type FitJob = {
  compMin: number | null;
  compMax: number | null;
  location: string;
  remoteType: RemoteType;
  companySize: CompanySize;
  growth: number;
  interest: number;
};

export type FitRequirement = { kind: RequirementKind; label: EvidenceLabel | null };

export type FitProfile = {
  compMin: number | null;
  remoteOk: boolean;
  targetLocations: string[];
  fitWeights: Partial<FitWeights> | null;
} | null;

export type FitComponent = {
  key: FitKey;
  label: string;
  weight: number;
  /** 0–1. */
  value: number;
  /** Points this component adds to the 0–100 score. */
  points: number;
  /** The most it could add at this weight. */
  maxPoints: number;
  detail: string;
};

export type FitResult = { score: number; components: FitComponent[] };

export const NEUTRAL = 0.5;

export function resolveWeights(weights: Partial<FitWeights> | null | undefined): FitWeights {
  const out = { ...DEFAULT_FIT_WEIGHTS };
  for (const key of Object.keys(out) as FitKey[]) {
    const value = weights?.[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) out[key] = value;
  }
  return out;
}

const money = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;
const scale = (value: number) => Math.min(1, Math.max(0, (Math.round(value) - 1) / 4));

export function scoreCompensation(job: Pick<FitJob, "compMin" | "compMax">, target: number | null): { value: number; detail: string } {
  if (target == null || target <= 0) return { value: NEUTRAL, detail: "No minimum pay saved in your profile, so this is neutral." };
  const low = job.compMin ?? job.compMax;
  const high = job.compMax ?? job.compMin;
  if (low == null || high == null) return { value: NEUTRAL, detail: "Pay isn't listed, so this is neutral." };
  if (low >= target) return { value: 1, detail: `Starts at or above your ${money(target)} minimum.` };
  if (high >= target) return { value: 0.75, detail: `The range reaches your ${money(target)} minimum.` };
  const ratio = high / target;
  if (ratio >= 0.9) return { value: 0.4, detail: `Tops out at ${money(high)}, just under your ${money(target)} minimum.` };
  if (ratio >= 0.75) return { value: 0.2, detail: `Tops out at ${money(high)}, well under your ${money(target)} minimum.` };
  return { value: 0, detail: `Tops out at ${money(high)}, far below your ${money(target)} minimum.` };
}

function locationMatches(jobLocation: string, target: string) {
  const a = normalizeText(jobLocation);
  const b = normalizeText(target);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const city = (value: string) => normalizeText(value.split(",")[0] ?? "");
  const ca = city(jobLocation);
  return ca.length > 0 && ca === city(target);
}

export function scoreLocation(job: Pick<FitJob, "location" | "remoteType">, profile: { remoteOk: boolean; targetLocations: string[] }): { value: number; detail: string } {
  const targets = profile.targetLocations.map((t) => t.trim()).filter(Boolean);
  if (job.remoteType === "remote" && profile.remoteOk) return { value: 1, detail: "Remote, and you're open to remote work." };
  const hit = targets.find((target) => locationMatches(job.location, target));
  if (hit) return { value: 1, detail: `Matches your target location “${hit}”.` };
  if (!job.location.trim() && job.remoteType === "unknown") return { value: NEUTRAL, detail: "Location isn't stated, so this is neutral." };
  if (job.remoteType === "remote") return { value: 0.15, detail: "Remote, but your profile says you're not looking for remote." };
  if (!targets.length) return { value: NEUTRAL, detail: "No target locations saved in your profile, so this is neutral." };
  return { value: 0.15, detail: "Outside your target locations." };
}

export function scoreEvidence(requirements: FitRequirement[]): { value: number; detail: string } {
  const relevant = requirements.filter((r) => r.kind === "must" || r.kind === "preferred");
  if (!relevant.length) return { value: NEUTRAL, detail: "No must-have or preferred requirements yet, so this is neutral." };
  const count = { strong: 0, transferable: 0, gap: 0, unmatched: 0 };
  for (const r of relevant) {
    if (r.label === "strong") count.strong += 1;
    else if (r.label === "transferable") count.transferable += 1;
    else if (r.label === "gap") count.gap += 1;
    else count.unmatched += 1;
  }
  if (count.unmatched === relevant.length) return { value: NEUTRAL, detail: "Evidence not matched yet, so this is neutral." };
  const value = (count.strong + count.transferable * 0.5 + count.unmatched * NEUTRAL) / relevant.length;
  const parts = [`${count.strong} strong`, `${count.transferable} transferable`, `${count.gap} gap${count.gap === 1 ? "" : "s"}`];
  if (count.unmatched) parts.push(`${count.unmatched} not matched`);
  return { value, detail: `${parts.join(", ")} across ${relevant.length} must-have and preferred requirements.` };
}

export function computeFit(job: FitJob, requirements: FitRequirement[], profile: FitProfile): FitResult {
  const saved = resolveWeights(profile?.fitWeights);
  const sum = (w: FitWeights) => ORDER.reduce((total, key) => total + w[key], 0);
  // All-zero weights would divide by zero; fall back to equal weights.
  const weights = sum(saved) > 0 ? saved : DEFAULT_FIT_WEIGHTS;
  const total = sum(weights);
  const size = COMPANY_SIZE_LABELS[job.companySize];
  const raw: Record<FitKey, { value: number; detail: string }> = {
    compensation: scoreCompensation(job, profile?.compMin ?? null),
    location: scoreLocation(job, { remoteOk: profile?.remoteOk ?? true, targetLocations: profile?.targetLocations ?? [] }),
    fit: scoreEvidence(requirements),
    companySize: {
      value: NEUTRAL,
      detail: job.companySize === "unknown" ? "Size unknown, and no size preference is saved, so this is neutral." : `${size}. No size preference is saved, so this is neutral.`,
    },
    growth: { value: scale(job.growth), detail: `You rated growth ${Math.round(job.growth)} of 5.` },
    interest: { value: scale(job.interest), detail: `You rated interest ${Math.round(job.interest)} of 5.` },
  };

  const exact = ORDER.map((key) => (100 * weights[key] * raw[key].value) / total);
  const score = Math.round(exact.reduce((a, b) => a + b, 0));
  const maxPoints = roundToTotal(ORDER.map((key) => (100 * weights[key]) / total), 100);
  const points = roundToTotal(exact, score, maxPoints);

  const components = ORDER.map((key, index) => ({
    key,
    label: FIT_LABELS[key],
    weight: weights[key],
    value: raw[key].value,
    points: points[index],
    maxPoints: maxPoints[index],
    detail: raw[key].detail,
  }));
  return { score, components };
}

/**
 * Rounds each value to an integer so the parts add up to `target` (largest
 * remainder), never pushing a part above its cap when caps are given.
 */
export function roundToTotal(values: number[], target: number, caps?: number[]): number[] {
  const cap = (i: number) => caps?.[i] ?? Infinity;
  const out = values.map((v, i) => Math.min(Math.floor(v), cap(i)));
  let remaining = target - out.reduce((a, b) => a + b, 0);
  const order = values.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remaining <= 0) break;
    if (out[i] + 1 > cap(i)) continue;
    out[i] += 1;
    remaining -= 1;
  }
  return out;
}

/** One line per component, for a hover title. */
export function fitSummary(result: FitResult) {
  return result.components.map((c) => `${c.label}: ${c.points}/${c.maxPoints}`).join(" · ");
}
