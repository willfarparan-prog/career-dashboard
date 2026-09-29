import type { SkillLine } from "@/db/schema";
import type { Achievement, Library, Role } from "@/lib/ai/library";

/*
 * Rule-based truth and quality checks. No model involved: these catch the
 * mechanical ways a tailored resume drifts from the record — numbers that
 * aren't in the achievement, titles that grew, SaaS claims without a SaaS
 * role, duplicates, vague filler — so the owner can defend every line.
 */

export type Severity = "error" | "warning" | "info";

export type Finding = {
  bulletId: string | null;
  kind: string;
  severity: Severity;
  message: string;
  suggestion: string;
};

export type CheckBullet = { id: string; roleId: string | null; achievementId: string | null; text: string; state: string };

export type CheckInput = {
  summary: string;
  skills: SkillLine[];
  roleOrder: string[];
  bullets: CheckBullet[];
  library: Library;
};

const YEAR = /^(19[5-9]\d|20\d\d)$/;

/** Numbers as written ("$1.2M", "35%", "1,200", "3x") reduced to comparable values. */
export function extractNumbers(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/\$?\d[\d,]*(?:\.\d+)?/g)) {
    const value = match[0].replace(/[$,]/g, "").replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
    if (value) found.push(value);
  }
  return found;
}

function achievementText(a: Achievement): string {
  return [
    a.headline,
    a.action,
    a.audience,
    a.scale,
    a.collaborators,
    a.outcome,
    a.evidenceNote,
    a.sourceQuote,
    a.tools.join(" "),
    ...a.metrics.map((m) => `${m.label} ${m.value} ${m.unit ?? ""}`),
  ].join(" ");
}

function roleYears(roles: Role[]): Set<string> {
  const years = new Set<string>();
  for (const role of roles) {
    for (const value of [role.start, role.end]) {
      const year = value.slice(0, 4);
      if (YEAR.test(year)) years.add(year);
    }
  }
  return years;
}

const normalizeWords = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9%$ ]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);

export function similarity(a: string, b: string): number {
  const left = new Set(normalizeWords(a));
  const right = new Set(normalizeWords(b));
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

const VAGUE = [
  "responsible for",
  "helped with",
  "helped to",
  "worked on",
  "assisted with",
  "involved in",
  "duties included",
  "tasked with",
  "various",
  "etc.",
  "a number of",
  "many different",
];

/** Titles a summary can imply ("…Manager with 8 years…"). Bullets are skipped: "partnered with account managers" is fine. */
const SENIORITY = ["director", "head of", "vice president", "vp", "chief", "principal", "manager"];

const SAAS = /\bsaas\b|software[- ]as[- ]a[- ]service|\bb2b software\b|\bsoftware compan(?:y|ies)\b/i;

function firstWord(text: string) {
  return text.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
}

export function runTruthChecks(input: CheckInput): Finding[] {
  const findings: Finding[] = [];
  const { library } = input;
  const achievementsById = new Map(library.achievements.map((a) => [a.id, a]));
  const rolesById = new Map(library.roles.map((r) => [r.id, r]));
  const years = roleYears(library.roles);
  const libraryText = [...library.achievements.map(achievementText), ...library.roles.map((r) => `${r.title} ${r.employer} ${r.summary}`)].join(" ");
  const libraryNumbers = new Set(extractNumbers(libraryText));
  const roleTitles = library.roles.map((r) => r.title.toLowerCase()).join(" | ");
  const hasSaasRole = library.roles.some((r) => r.isSaas);
  const live = input.bullets.filter((b) => b.state !== "rejected");

  const add = (finding: Finding) => findings.push(finding);

  // Every sentence must point at a real achievement.
  for (const bullet of live) {
    const achievement = bullet.achievementId ? achievementsById.get(bullet.achievementId) : undefined;
    if (!achievement) {
      add({
        bulletId: bullet.id,
        kind: "unsupported",
        severity: "error",
        message: "No achievement in your library supports this sentence.",
        suggestion: "Link it to a real achievement, rewrite it from one, or reject it.",
      });
    } else {
      const supported = new Set(extractNumbers(achievementText(achievement)));
      const missing = extractNumbers(bullet.text).filter((n) => !supported.has(n) && !(YEAR.test(n) && years.has(n)));
      if (missing.length) {
        add({
          bulletId: bullet.id,
          kind: "invented_metric",
          severity: "error",
          message: `${missing.map((n) => `"${n}"`).join(", ")} ${missing.length === 1 ? "isn't" : "aren't"} in the linked achievement.`,
          suggestion: "Use only numbers you recorded, or add the metric to the achievement first.",
        });
      }
      if (achievement.factStatus === "approximate" || achievement.factStatus === "needs_confirmation") {
        add({
          bulletId: bullet.id,
          kind: "unverified_fact",
          severity: "warning",
          message: `Built on an achievement marked "${achievement.factStatus.replace("_", " ")}".`,
          suggestion: "Confirm the details in your achievement bank before you send this.",
        });
      }
      if (achievement.factStatus === "private") {
        add({ bulletId: bullet.id, kind: "private_fact", severity: "error", message: "Uses an achievement you marked private.", suggestion: "Reject this bullet or change the achievement's status." });
      }
      if (bullet.roleId && achievement.roleId && bullet.roleId !== achievement.roleId) {
        const role = rolesById.get(achievement.roleId);
        add({
          bulletId: bullet.id,
          kind: "wrong_role",
          severity: "error",
          message: `This achievement belongs to ${role ? `${role.title} at ${role.employer}` : "another role"}.`,
          suggestion: "Move it under the role where it happened.",
        });
      }
    }
  }

  // Inflated titles (summary) and unsupported SaaS claims (everywhere).
  const texts: Array<{ bulletId: string | null; text: string }> = [{ bulletId: null, text: input.summary }, ...live.map((b) => ({ bulletId: b.id, text: b.text }))];
  for (const { bulletId, text } of texts) {
    const lower = ` ${text.toLowerCase()} `;
    const inflated = bulletId === null ? SENIORITY.find((word) => new RegExp(`\\b${word}\\b`).test(lower) && !roleTitles.includes(word)) : undefined;
    if (inflated) {
      add({
        bulletId,
        kind: "inflated_title",
        severity: "warning",
        message: `"${inflated}" doesn't appear in any of your job titles.`,
        suggestion: "Describe what you did rather than implying a title you didn't hold.",
      });
    }
    if (SAAS.test(text) && !hasSaasRole) {
      add({
        bulletId,
        kind: "saas_claim",
        severity: "error",
        message: "Claims SaaS or software-company experience, but no role is marked SaaS.",
        suggestion: "Describe the transferable work (onboarding, adoption, retention) without the SaaS label.",
      });
    }
  }

  // Summary numbers must exist somewhere in the library.
  const summaryMissing = extractNumbers(input.summary).filter((n) => !libraryNumbers.has(n) && !(YEAR.test(n) && years.has(n)));
  if (summaryMissing.length) {
    add({
      bulletId: null,
      kind: "invented_metric",
      severity: "warning",
      message: `The summary mentions ${summaryMissing.map((n) => `"${n}"`).join(", ")}, which isn't in your library.`,
      suggestion: "Make sure you can back it up (for years of experience, check your role dates).",
    });
  }
  if (!input.summary.trim()) {
    add({ bulletId: null, kind: "missing_summary", severity: "info", message: "There's no summary yet.", suggestion: "Add two or three sentences aimed at this role." });
  }

  // Dates on the roles this resume shows.
  for (const roleId of input.roleOrder) {
    const role = rolesById.get(roleId);
    if (!role) continue;
    const label = `${role.title} at ${role.employer}`;
    if (!role.start) add({ bulletId: null, kind: "date", severity: "warning", message: `${label} has no start date.`, suggestion: "Add it on your profile." });
    if (!role.isCurrent && !role.end) add({ bulletId: null, kind: "date", severity: "warning", message: `${label} has no end date and isn't marked current.`, suggestion: "Add an end date or mark it current." });
    if (role.isCurrent && role.end) add({ bulletId: null, kind: "date", severity: "warning", message: `${label} is marked current but has an end date.`, suggestion: "Clear one of them." });
    if (role.start && role.end && !role.isCurrent && role.end.localeCompare(role.start) < 0) {
      add({ bulletId: null, kind: "date", severity: "error", message: `${label} ends before it starts.`, suggestion: "Fix the dates on your profile." });
    }
    if (role.factStatus === "needs_confirmation" || role.factStatus === "approximate") {
      add({ bulletId: null, kind: "unverified_fact", severity: "warning", message: `${label}: title or dates aren't verified yet.`, suggestion: "Confirm the exact title and dates on your profile." });
    }
  }

  // Duplicates and near-duplicates.
  for (let i = 0; i < live.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      const score = similarity(live[i].text, live[j].text);
      if (live[i].text.trim().toLowerCase() === live[j].text.trim().toLowerCase()) {
        add({ bulletId: live[i].id, kind: "duplicate", severity: "error", message: "This bullet repeats another one word for word.", suggestion: "Reject one of them." });
        break;
      }
      if (score >= 0.7) {
        add({ bulletId: live[i].id, kind: "duplicate", severity: "warning", message: "Very close to another bullet.", suggestion: "Merge them or make each one say something different." });
        break;
      }
    }
  }

  // Vague filler, length, and repeated opening verbs.
  const verbCounts = new Map<string, number>();
  for (const bullet of live) {
    const lower = bullet.text.toLowerCase();
    const vague = VAGUE.find((phrase) => lower.includes(phrase));
    if (vague) {
      add({ bulletId: bullet.id, kind: "vague", severity: "warning", message: `"${vague}" is vague.`, suggestion: "Lead with what you did and what changed because of it." });
    }
    const words = bullet.text.trim().split(/\s+/).filter(Boolean).length;
    if (words > 40) add({ bulletId: bullet.id, kind: "length", severity: "info", message: `${words} words — long for a bullet.`, suggestion: "Aim for one line or two (under about 30 words)." });
    if (words > 0 && words < 5) add({ bulletId: bullet.id, kind: "length", severity: "info", message: "Very short — it may not say enough.", suggestion: "Add what changed and for whom." });
    const verb = firstWord(bullet.text);
    if (verb) {
      const count = (verbCounts.get(verb) ?? 0) + 1;
      verbCounts.set(verb, count);
      if (count === 3) add({ bulletId: bullet.id, kind: "repetition", severity: "info", message: `"${verb}" starts three or more bullets.`, suggestion: "Vary the opening verbs." });
    }
  }

  // Skills must come from the library.
  const knownSkills = new Set([...library.skills.map((s) => s.name.toLowerCase()), ...library.achievements.flatMap((a) => a.tools.map((t) => t.toLowerCase()))]);
  for (const skill of input.skills) {
    if (!knownSkills.has(skill.name.trim().toLowerCase())) {
      add({ bulletId: null, kind: "unsupported_skill", severity: "warning", message: `"${skill.name}" isn't in your skills or tools.`, suggestion: "Add it to your library if it's true, or remove it." });
    }
  }

  return findings;
}

/** A stable identity for a finding, so dismissals survive re-running the checks. */
export function findingKey(finding: Pick<Finding, "bulletId" | "kind" | "message">) {
  return `${finding.kind}|${finding.bulletId ?? "-"}|${finding.message}`;
}
