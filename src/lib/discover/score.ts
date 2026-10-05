import type { CareerPath, DiscoverMode, ScoreReason } from "@/db/schema";
import { CAREER_PATH_LABELS, normalizeText } from "@/lib/jobs/format";
import { keywordHits, queryKeywords } from "./text";
import type { NormalizedLead } from "./types";

/*
 * A quick, keyword-only ranking for Discover (no Claude). Each part adds
 * signed points and says why; the reasons always add up to the score.
 *
 *   Title vs. search words      up to 40
 *   Target-role vocabulary      up to 20
 *   Location                    up to 15 (neutral 7)
 *   Pay vs. your minimum        up to 10 (neutral 5; below minimum −10)
 *   Freshness                   up to 15 (unknown 5)
 *   Clear mismatches            −15 to −30 each
 */

export type ScoreContext = {
  query: string;
  targetLocations: string[];
  remoteOk: boolean;
  compMin: number | null;
  targetRoles: string[];
  mode?: DiscoverMode;
  directionTerms?: string[];
};

export type LeadScore = { score: number; reasons: ScoreReason[] };

const DAY_MS = 86_400_000;

const ROLE_VOCABULARY: Record<CareerPath, RegExp> = {
  customer_success: /\b(customer success|client success|csm|customer onboarding|customer outcomes?|customer retention)\b/,
  implementation: /\b(implementations?|onboarding)\b/,
  account_management: /\b(account manager|account management|client account|relationship manager|client relationship)\b/,
  employer_wellbeing: /\b(well ?being|wellness|benefits|(employee|employer|member|customer|client) engagement)\b/,
  // Titles are plain()ed first, so "S&C" reads "s c" and "TSAC-F" reads "tsac f".
  strength_conditioning: /\b(strength (and )?conditioning|strength coach|s c coach|tsac|tactical (strength|performance|facilitator|athlete)|human performance|performance (coach|specialist)|sports performance|athletic performance|exercise physiologist)\b/,
  other: /\b(client services?|customer experience)\b/,
};

const ALL_PATHS = Object.keys(ROLE_VOCABULARY) as CareerPath[];

const MISMATCHES: Array<{ pattern: RegExp; label: string; points: number }> = [
  { pattern: /\b(engineer|engineering|developer|programmer|devops|sre)\b/, label: "Engineering role", points: -30 },
  { pattern: /\b(nurse|nursing|rn|lpn|cna)\b/, label: "Nursing role", points: -30 },
  { pattern: /\b(driver|drivers|cdl|courier)\b/, label: "Driver role", points: -30 },
  { pattern: /\b(director|vp|svp|evp|vice president|head of|chief)\b/, label: "Director/VP level", points: -20 },
  { pattern: /\b(sales development|business development representative|sdr|bdr)\b/, label: "Sales development role", points: -25 },
  { pattern: /\baccount executive\b/, label: "Account executive (sales) role", points: -15 },
];

/** Lowercase, punctuation to spaces, "well-being" → "well being". */
function plain(text: string): string {
  return ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
}

function locationMatches(jobLocation: string, target: string): boolean {
  const a = normalizeText(jobLocation);
  const b = normalizeText(target);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const city = (value: string) => normalizeText(value.split(",")[0] ?? "");
  const ca = city(jobLocation);
  return ca.length > 2 && ca === city(target);
}

function titlePoints(title: string, description: string, query: string): ScoreReason {
  const keywords = queryKeywords(query);
  if (!keywords.length) return { label: "No search words to match", points: 0 };
  const hits = keywordHits(title, keywords);
  if (hits === keywords.length) return { label: "Title matches your search", points: 40 };
  if (hits > 0) return { label: `Title matches ${hits} of ${keywords.length} search words`, points: Math.round((40 * hits) / keywords.length) };
  if (keywordHits(description, keywords) >= Math.ceil(keywords.length / 2)) return { label: "Search words only in the description", points: 5 };
  return { label: "Title doesn't match your search", points: 0 };
}

function rolePoints(title: string, targetRoles: string[]): ScoreReason | null {
  const text = plain(title);
  const targets = ALL_PATHS.filter((path) => targetRoles.includes(path));
  for (const path of targets.length ? targets : ALL_PATHS) {
    if (ROLE_VOCABULARY[path].test(text)) return { label: `${CAREER_PATH_LABELS[path]} role`, points: 20 };
  }
  return null;
}

function locationPoints(lead: NormalizedLead, targetLocations: string[], remoteOk: boolean): ScoreReason {
  const targets = targetLocations.map((t) => t.trim()).filter(Boolean);
  if (lead.isRemote && remoteOk) return { label: "Remote", points: 15 };
  const hit = targets.find((target) => locationMatches(lead.location, target));
  if (hit) return { label: `In ${hit}`, points: 15 };
  if (lead.isRemote) return { label: "Remote, but you're not looking for remote", points: 0 };
  if (!lead.location.trim()) return { label: "Location not stated", points: 7 };
  if (!targets.length) return { label: "No target locations set", points: 7 };
  return { label: "Outside your target locations", points: 0 };
}

function payPoints(lead: NormalizedLead, compMin: number | null): ScoreReason {
  if (compMin == null || compMin <= 0) return { label: "No minimum pay set", points: 5 };
  const low = lead.salaryMin ?? lead.salaryMax;
  const high = lead.salaryMax ?? lead.salaryMin;
  if (low == null || high == null) return { label: "Pay not listed", points: 5 };
  if (low >= compMin) return { label: "Pay meets your minimum", points: 10 };
  if (high >= compMin) return { label: "Pay range reaches your minimum", points: 7 };
  return { label: "Pay below your minimum", points: -10 };
}

function freshnessPoints(postedAt: Date | null, now: Date): ScoreReason {
  if (!postedAt) return { label: "Post date unknown", points: 5 };
  const days = Math.max(0, Math.floor((now.getTime() - postedAt.getTime()) / DAY_MS));
  const label = days === 0 ? "Posted today" : `Posted ${days} day${days === 1 ? "" : "s"} ago`;
  if (days <= 3) return { label, points: 15 };
  if (days <= 7) return { label, points: 10 };
  if (days <= 14) return { label, points: 5 };
  return { label, points: 0 };
}

/** 0–100 with signed, labeled reasons that add up to the score. */
export function scoreLead(lead: NormalizedLead, context: ScoreContext, now = new Date()): LeadScore {
  const reasons: ScoreReason[] = [titlePoints(lead.title, lead.description, context.query)];
  const terms = context.directionTerms?.length ? context.directionTerms : [context.query];
  const alternativeMatch = terms.some((term) => {
    const keywords = queryKeywords(term);
    return keywords.length > 0 && keywordHits(lead.title, keywords) === keywords.length;
  });
  const role = context.mode === "explore"
    ? alternativeMatch ? { label: "Matches your alternative direction", points: 20 } : null
    : rolePoints(lead.title, context.targetRoles);
  if (role) reasons.push(role);
  reasons.push(locationPoints(lead, context.targetLocations, context.remoteOk));
  reasons.push(context.mode === "explore" && lead.salaryProvenance !== "disclosed"
    ? { label: "Pay unconfirmed", points: 5 } : payPoints(lead, context.compMin));
  reasons.push(freshnessPoints(lead.postedAt, now));
  const title = plain(lead.title);
  for (const mismatch of MISMATCHES) {
    if (mismatch.pattern.test(title)) reasons.push({ label: mismatch.label, points: mismatch.points });
  }

  const raw = reasons.reduce((total, r) => total + r.points, 0);
  const score = Math.min(100, Math.max(0, raw));
  if (raw < 0) reasons.push({ label: "Floor at 0", points: -raw });
  if (raw > 100) reasons.push({ label: "Capped at 100", points: 100 - raw });
  return { score, reasons };
}
