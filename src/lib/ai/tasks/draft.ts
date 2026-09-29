import { z } from "zod";
import type { CareerPath } from "@/db/schema";
import type { LibraryContext } from "@/lib/ai/library";
import { runStructured, type StructuredResult } from "@/lib/ai/run";

export const PROMPT_VERSION = "draft@1";

export const DraftSchema = z.object({
  summary: z.object({ text: z.string(), evidence: z.array(z.string()) }),
  skills: z.array(z.object({ name: z.string(), evidence: z.array(z.string()) })),
  roles: z.array(
    z.object({
      role: z.string(),
      bullets: z.array(z.object({ text: z.string(), achievement: z.string().nullable(), jobTerms: z.array(z.string()) })),
    }),
  ),
  notes: z.array(z.string()),
});
export type DraftOutput = z.infer<typeof DraftSchema>;

export const CAREER_PATH_LABELS: Record<CareerPath, string> = {
  customer_success: "Customer success",
  implementation: "Implementation / onboarding",
  account_management: "Account management",
  employer_wellbeing: "Employer wellbeing / benefits",
  other: "Other",
};

export type DraftJob = {
  company: string;
  title: string;
  summary: string;
  requirements: Array<{ kind: string; text: string; label: string | null; achievements: string[]; translation: string }>;
};

const INSTRUCTIONS = `Draft a tailored, single-column resume for the target job below, using only the career library.

Rules:
- Every bullet names exactly one achievement alias (A1, A2…) it is written from, placed under the role (R1, R2…) that achievement belongs to. If a sentence can't be tied to an achievement, leave it out.
- Numbers: use only the numbers recorded in that achievement, exactly as recorded. Never round, combine, estimate or add numbers.
- Titles, employers and dates come from the library; don't restate or upgrade them in bullets.
- Borrow the job's wording only when it truthfully describes the achievement, and list the borrowed terms in jobTerms.
- Translate coaching, program ownership, stakeholder work and client adoption into business language (onboarding, adoption, retention, stakeholder management, program delivery). Never call it SaaS or software experience unless the role is marked "SaaS: yes".
- Give the most relevant roles 3–6 bullets and less relevant roles 0–2. Order bullets by how directly they meet the must-have requirements. Include every role in the library, even with zero bullets.
- Bullet style: start with a strong verb (past tense for past roles, present for current), about 30 words or fewer, action + scope + result.
- Summary: 2–3 sentences aimed at this role, honest about the career change; list the achievement aliases it relies on.
- Skills: 8–14 items taken only from the library's skills and achievement tools; evidence = aliases of achievements that show the skill (can be empty for a listed skill).
- notes: up to 5 short notes for the candidate — gaps to address or metrics that would make a bullet stronger.`;

function describeJob(job: DraftJob, careerPath: CareerPath, emphasis: string) {
  const lines = [
    "# Target job",
    `Company: ${job.company || "(unknown)"}`,
    `Title: ${job.title || "(unknown)"}`,
    `Positioning: ${CAREER_PATH_LABELS[careerPath]}`,
  ];
  if (job.summary) lines.push(`About the role: ${job.summary}`);
  if (emphasis) lines.push(`Owner's emphasis for this draft: ${emphasis}`);
  lines.push("## Requirements and matched evidence");
  for (const req of job.requirements) {
    const evidence = req.achievements.length ? ` — ${req.label ?? "unmatched"} via ${req.achievements.join(", ")}` : ` — ${req.label ?? "unmatched"}`;
    lines.push(`- [${req.kind}] ${req.text}${evidence}${req.translation ? ` (translation: ${req.translation})` : ""}`);
  }
  if (!job.requirements.length) lines.push("(The posting hasn't been analyzed; draft a general version for the positioning above.)");
  return lines.join("\n");
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A no-Claude draft straight from the library: each achievement becomes one bullet. */
export function libraryDraft(context: LibraryContext, headline: string): DraftOutput {
  const roles = [...context.roleByAlias.entries()].map(([alias, role]) => ({
    role: alias,
    bullets: [...context.achievementByAlias.entries()]
      .filter(([, a]) => a.roleId === role.id)
      .slice(0, 5)
      .map(([aliasA, a]) => {
        const base = capitalize((a.action || a.headline).trim().replace(/\.$/, ""));
        const outcome = a.outcome.trim().replace(/\.$/, "");
        return { text: outcome ? `${base}; ${outcome.charAt(0).toLowerCase()}${outcome.slice(1)}.` : `${base}.`, achievement: aliasA, jobTerms: [] };
      }),
  }));
  const evidence = [...context.achievementByAlias.keys()].slice(0, 2);
  const skills = context.text
    .split("\n")
    .filter((line) => line.startsWith("- ") && /\((skill|tool|domain),/.test(line))
    .slice(0, 12)
    .map((line) => ({ name: line.slice(2).replace(/\s*\((skill|tool|domain),.*$/, ""), evidence: [] }));
  return { summary: { text: headline, evidence }, skills, roles, notes: [] };
}

export async function runDraft(args: {
  userId: string;
  context: LibraryContext;
  job: DraftJob;
  careerPath: CareerPath;
  emphasis: string;
  headline: string;
  refId?: string;
}): Promise<StructuredResult<DraftOutput>> {
  return runStructured({
    userId: args.userId,
    task: "draft",
    promptVersion: PROMPT_VERSION,
    schema: DraftSchema,
    context: args.context.text,
    instructions: INSTRUCTIONS,
    content: describeJob(args.job, args.careerPath, args.emphasis),
    effort: "high",
    refId: args.refId,
    fake: () => {
      const draft = libraryDraft(args.context, args.headline || `${CAREER_PATH_LABELS[args.careerPath]} candidate with a coaching background.`);
      return { ...draft, notes: ["(fake mode) Draft built from the library without Claude."] };
    },
  });
}
