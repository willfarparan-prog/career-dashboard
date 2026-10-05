import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/db";
import { CAREER_PATHS, jobRequirements, jobs, type CareerPath, type JobAnalysis, type RequirementKind } from "@/db/schema";
import { runStructured } from "@/lib/ai/run";
import { isIsoDate, normalizeText } from "@/lib/jobs/format";
import { listRequirements, requireJob, type Job } from "@/lib/jobs/jobs";

/*
 * Posting → structured job. Claude extracts; it doesn't embellish. Anything
 * the owner typed at intake wins: analysis only fills blanks.
 */

export const PROMPT_VERSION = "analyze@2";

export const analysisSchema = z.object({
  company: z.string().describe("Hiring company as written, or \"\" if not stated."),
  title: z.string().describe("Job title as written, or \"\"."),
  location: z.string().describe("Location as written (city, region, country), or \"\"."),
  remoteType: z.enum(["remote", "hybrid", "onsite", "unknown"]),
  compMin: z.number().nullable().describe("Lowest annual base pay in whole US dollars, or null if the posting gives no annual USD figure."),
  compMax: z.number().nullable().describe("Highest annual base pay in whole US dollars, or null."),
  compText: z.string().describe("The pay wording exactly as the posting states it, or \"\"."),
  deadline: z.string().describe("Application deadline as YYYY-MM-DD, or \"\" if none is given."),
  requisitionId: z.string().describe("Requisition / job ID as written, or \"\"."),
  seniority: z.string().describe("Level as stated or clear from the title (e.g. Associate, Senior, Manager), or \"\"."),
  summary: z.string().describe("Two plain sentences on what the role is for."),
  companySize: z.enum(["startup", "mid", "enterprise", "unknown"]),
  careerPath: z.enum(CAREER_PATHS),
  requirements: z.array(
    z.object({
      kind: z.enum(["must", "preferred", "responsibility", "tool"]),
      text: z.string(),
    }),
  ),
  screeningQuestions: z.array(z.string()),
  tools: z.array(z.string()),
});

export type AnalysisOutput = z.infer<typeof analysisSchema>;

const INSTRUCTIONS = `Extract the job posting in the user message into the schema. Extract, don't embellish: use only what the posting says, in its own words.

- Leave a field "" (or null for pay) when the posting doesn't state it. Never guess the company, location, pay, deadline or requisition ID.
- Pay: compMin/compMax are annual base salary in whole US dollars. compText is the pay wording as written.
- requirements: one item per requirement. Split compound requirements ("Salesforce and Gainsight experience" → two items; "3+ years in customer success or account management" stays one because it is a single bar).
  - "must" only when the posting says so: words like required, must, minimum, or a heading such as "Required qualifications" or "Minimum requirements". Otherwise qualifications are "preferred".
  - "responsibility" for duties the person will do. "tool" for named software or platforms the posting asks for.
- screeningQuestions: questions the posting asks applicants to answer, verbatim. [] if none.
- tools: every named software, platform or system in the posting.
- companySize: only when the posting says (headcount, "startup", "Fortune 500"…); otherwise "unknown".
- careerPath: the closest of customer_success, implementation, account_management, employer_wellbeing (benefits, wellness, EAP, people programs), strength_conditioning (strength & conditioning, sports / tactical / human-performance coaching), or other.`;

/* ---------- Deterministic stand-in for Claude (AI_FAKE=1) ---------- */

const TOOL_NAMES = ["Salesforce", "Gainsight", "HubSpot", "Zendesk", "Jira", "Excel", "Slack", "Asana", "Totango", "ChurnZero", "Intercom", "Looker", "Tableau", "SQL", "Notion", "Zoom", "Workday", "Google Workspace"];

function labelled(lines: string[], ...names: string[]): string {
  for (const line of lines) {
    const match = line.match(/^([A-Za-z ]+):\s*(.+)$/);
    if (match && names.includes(match[1].trim().toLowerCase())) return match[2].trim();
  }
  return "";
}

/** Parses "$85,000 – $100,000", "$85k-$100k" or "$90,000" into annual USD. */
export function parseCompRange(text: string): { min: number | null; max: number | null; text: string } {
  const match = text.match(/\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k)?(?:\s*(?:-|–|—|to)\s*\$?\s?(\d[\d,]*(?:\.\d+)?)\s*(k)?)?/i);
  if (!match) return { min: null, max: null, text: "" };
  const value = (digits: string, k?: string) => Math.round(Number(digits.replace(/,/g, "")) * (k ? 1000 : 1));
  const min = value(match[1], match[2] ?? match[4]);
  const max = match[3] ? value(match[3], match[4]) : min;
  if (/hour|\/\s?hr/i.test(text.slice(match.index ?? 0, (match.index ?? 0) + match[0].length + 12))) return { min: null, max: null, text: match[0].trim() };
  return { min, max, text: match[0].trim() };
}

function fakeCareerPath(text: string): CareerPath {
  const t = text.toLowerCase();
  if (/implementation|onboarding specialist/.test(t)) return "implementation";
  if (/account manag/.test(t)) return "account_management";
  // Before wellbeing: S&C postings often mention wellness too.
  if (/strength (and|&) conditioning|strength coach|tactical (strength|performance)|human performance|sports performance|\bcscs\b|\btsac/.test(t)) return "strength_conditioning";
  if (/well-?being|wellness|benefits/.test(t)) return "employer_wellbeing";
  if (/customer success/.test(t)) return "customer_success";
  return "other";
}

/** A rough, rule-based reading of a posting: section headings set the kind, bullets become requirements. */
export function fakeAnalysis(postingText: string): AnalysisOutput {
  const lines = postingText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const lower = postingText.toLowerCase();
  const requirements: AnalysisOutput["requirements"] = [];
  const screeningQuestions: string[] = [];
  let section: AnalysisOutput["requirements"][number]["kind"] = "responsibility";
  let inScreening = false;
  for (const line of lines) {
    const bullet = line.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
    if (!bullet) {
      const heading = line.toLowerCase();
      inScreening = /screening|application questions/.test(heading);
      if (/required|minimum|must/.test(heading)) section = "must";
      else if (/preferred|nice to have|bonus/.test(heading)) section = "preferred";
      else if (/tools|tech stack|systems/.test(heading)) section = "tool";
      else if (/responsibilit|what you.ll do|you will/.test(heading)) section = "responsibility";
      else if (/qualifications|requirements/.test(heading)) section = "preferred";
      continue;
    }
    const text = bullet[1].trim();
    if (inScreening || text.endsWith("?")) {
      screeningQuestions.push(text);
      continue;
    }
    let kind = section;
    if (/\b(required|must|minimum)\b/i.test(text)) kind = "must";
    else if (/\b(preferred|nice to have|a plus|bonus)\b/i.test(text)) kind = "preferred";
    requirements.push({ kind, text });
  }
  const comp = parseCompRange(labelled(lines, "salary", "pay", "compensation") || postingText);
  const deadline = postingText.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1] ?? "";
  const title = labelled(lines, "title", "role", "position") || (lines[0] ?? "").slice(0, 80);
  return {
    company: labelled(lines, "company", "employer"),
    title,
    location: labelled(lines, "location"),
    remoteType: /\bhybrid\b/.test(lower) ? "hybrid" : /\bremote\b/.test(lower) ? "remote" : /\bon-?site\b|in office/.test(lower) ? "onsite" : "unknown",
    compMin: comp.min,
    compMax: comp.max,
    compText: comp.text,
    deadline: isIsoDate(deadline) ? deadline : "",
    requisitionId: labelled(lines, "requisition id", "req id", "job id", "requisition"),
    seniority: /\b(senior|sr\.?|lead|principal)\b/i.test(title) ? "Senior" : /\b(associate|junior|entry)\b/i.test(title) ? "Entry" : "",
    summary: lines.find((l) => l.length > 60 && !/^[-*•]/.test(l))?.slice(0, 240) ?? "",
    companySize: /\bstartup\b/.test(lower) ? "startup" : /fortune 500|enterprise company|10,000\+ employees/.test(lower) ? "enterprise" : "unknown",
    careerPath: fakeCareerPath(`${title}\n${postingText}`),
    requirements,
    screeningQuestions,
    tools: TOOL_NAMES.filter((tool) => new RegExp(`\\b${tool.toLowerCase()}\\b`).test(lower)),
  };
}

/* ---------- Applying the output ---------- */

const clean = (value: string) => value.replace(/\s+/g, " ").trim();

function annualUsd(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  // Under $1,000 is an hourly rate or a "k" slip, not an annual salary.
  return rounded >= 1000 ? rounded : null;
}

/**
 * The job fields to change: only ones the owner left blank. Career path has
 * no "blank" state, so analysis sets it only the first time.
 */
export function mergeAnalysis(job: Job, output: AnalysisOutput): Partial<typeof jobs.$inferInsert> {
  const patch: Partial<typeof jobs.$inferInsert> = {};
  const fill = (key: "company" | "title" | "location" | "compText" | "requisitionId", value: string) => {
    if (!job[key].trim() && clean(value)) patch[key] = clean(value);
  };
  fill("company", output.company);
  fill("title", output.title);
  fill("location", output.location);
  fill("compText", output.compText);
  fill("requisitionId", output.requisitionId);
  if (!job.deadline && isIsoDate(output.deadline.trim())) patch.deadline = output.deadline.trim();
  if (job.remoteType === "unknown" && output.remoteType !== "unknown") patch.remoteType = output.remoteType;
  if (job.companySize === "unknown" && output.companySize !== "unknown") patch.companySize = output.companySize;

  let min = annualUsd(output.compMin);
  let max = annualUsd(output.compMax);
  if (min != null && max != null && min > max) [min, max] = [max, min];
  if (job.compMin == null && min != null) patch.compMin = min;
  if (job.compMax == null && max != null) patch.compMax = max;

  if (!job.analyzedAt) patch.careerPath = output.careerPath;
  return patch;
}

type RequirementRow = typeof jobRequirements.$inferInsert;

/** New requirement rows, deduplicated, with screening questions last. */
export function requirementRows(userId: string, jobId: string, output: AnalysisOutput): RequirementRow[] {
  const seen = new Set<string>();
  const rows: RequirementRow[] = [];
  const add = (kind: RequirementKind, raw: string) => {
    const text = clean(raw);
    const key = `${kind}|${normalizeText(text)}`;
    if (!text || seen.has(key)) return;
    seen.add(key);
    rows.push({ userId, jobId, kind, text, position: rows.length });
  };
  for (const r of output.requirements) add(r.kind, r.text);
  for (const q of output.screeningQuestions) add("screening", q);
  return rows;
}

export async function analyzeJob(db: Database, userId: string, jobId: string) {
  const job = await requireJob(db, userId, jobId);
  const result = await runStructured({
    userId,
    task: "analyze",
    promptVersion: PROMPT_VERSION,
    schema: analysisSchema,
    instructions: INSTRUCTIONS,
    content: `Job posting:\n<posting>\n${job.postingText}\n</posting>`,
    effort: "low",
    refId: job.id,
    fake: () => fakeAnalysis(job.postingText),
  });
  const output = result.output;

  const rows = requirementRows(userId, job.id, output);
  const analysis: JobAnalysis = {
    summary: clean(output.summary),
    responsibilities: rows.filter((r) => r.kind === "responsibility").map((r) => r.text),
    tools: [...new Set(output.tools.map(clean).filter(Boolean))],
    screeningQuestions: rows.filter((r) => r.kind === "screening").map((r) => r.text),
    seniority: clean(output.seniority),
  };

  // The owner's own label calls survive re-analysis when the requirement text is unchanged.
  const previous = await listRequirements(db, userId, job.id);
  const kept = new Map(previous.filter((r) => r.labelOverridden).map((r) => [`${r.kind}|${normalizeText(r.text)}`, r]));
  for (const row of rows) {
    const old = kept.get(`${row.kind}|${normalizeText(row.text)}`);
    if (old) Object.assign(row, { label: old.label, labelOverridden: true, achievementIds: old.achievementIds, rationale: old.rationale, translation: old.translation });
  }

  await db.delete(jobRequirements).where(and(eq(jobRequirements.jobId, job.id), eq(jobRequirements.userId, userId)));
  if (rows.length) await db.insert(jobRequirements).values(rows);
  await db
    .update(jobs)
    .set({
      ...mergeAnalysis(job, output),
      analysis,
      analyzedAt: new Date(),
      // New requirements need a fresh match.
      matchedAt: null,
      model: result.model,
      promptVersion: result.promptVersion,
      updatedAt: new Date(),
    })
    .where(and(eq(jobs.id, job.id), eq(jobs.userId, userId)));

  return { requirements: rows.length };
}
