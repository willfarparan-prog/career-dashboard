import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/db";
import { jobRequirements, jobs, resumeDrafts, type EvidencedText } from "@/db/schema";
import { buildLibraryContext, loadLibrary, resolveAliases, type LibraryContext } from "@/lib/ai/library";
import { runStructured } from "@/lib/ai/run";
import { CoverLetterError, createCoverLetter, findBaseDraft, type CoverLetter } from "@/lib/cover/letters";

/*
 * Drafts the body of a cover letter for one job from the career library, the
 * job's matched requirements, and (when there is one) the resume draft it goes
 * with. Every paragraph lists the achievements it draws on; aliases Claude
 * invents are dropped. The result is a new draft letter the owner reviews.
 */

export const PROMPT_VERSION = "cover@1";

export const COVER_TONES = ["warm", "direct", "formal"] as const;
export type CoverTone = (typeof COVER_TONES)[number];

export function normalizeTone(value: string | null | undefined): CoverTone {
  const tone = (value ?? "").trim().toLowerCase();
  return (COVER_TONES as readonly string[]).includes(tone) ? (tone as CoverTone) : "warm";
}

export const coverLetterSchema = z.object({
  paragraphs: z.array(
    z.object({
      text: z.string().describe("One paragraph of the letter body. No greeting, date or sign-off."),
      evidence: z.array(z.string()).describe("Aliases (A1, A2…) of the achievements whose facts this paragraph uses. [] when it makes no claim about past work."),
    }),
  ),
});
export type CoverLetterOutput = z.infer<typeof coverLetterSchema>;

const TONES: Record<CoverTone, string> = {
  warm: "warm: friendly and personal, still specific and brief",
  direct: "direct: brisk and plain, evidence first, no warm-up",
  formal: "formal: polished and reserved, no contractions",
};

const INSTRUCTIONS = `You write the body of a cover letter for one specific job, using only the career library.

Output 3 or 4 short paragraphs, about 250–350 words in total. For each paragraph, list in "evidence" the aliases (A1, A2…) of the achievements whose facts it uses; use [] for a paragraph that makes no claim about past work. Write only the body: no date, address, greeting ("Dear …") or sign-off ("Sincerely …") — the app adds those.

Shape:
1. Why this role at this company, and the one-line case for the candidate. Be specific to the posting, not generic praise.
2–3. One or two concrete stories from the library that answer the most important requirements. Lead with strong evidence. For transferable evidence, name the skill plainly and show how it carries over (for example: coaching and program ownership → onboarding and adoption; stakeholder work → account relationships and renewals).
Last. A short, confident close: what they would focus on first in the role, and an invitation to talk.

Honesty rules:
- Every fact about the candidate comes from the library. Never invent employers, titles, tools, clients, numbers or outcomes.
- Use a number only if it appears in an achievement you cite. Hedge approximate numbers ("about", "roughly"). Skip numbers whose status is needs_confirmation.
- If this is a career change, say so plainly and frame the earlier work as transferable. Claim formal SaaS or software-company experience only if a role marked "SaaS: yes" supports it.
- Don't claim a requirement labeled gap, and don't apologise for it either.
- If a resume summary is given, stay consistent with it without repeating it.

Style: plain, specific, first person, active voice, short sentences. No clichés or filler — avoid "I am writing to express my interest", "passionate", "perfect fit", "team player", "hit the ground running", "results-driven", "dynamic", "synergy", "go-getter", "think outside the box", "I believe I would be a great".`;

type Job = typeof jobs.$inferSelect;
type Requirement = typeof jobRequirements.$inferSelect;
type Draft = typeof resumeDrafts.$inferSelect;

export type CoverInputs = { job: Job; requirements: Requirement[]; draft: Draft | null; context: LibraryContext };

/**
 * `draftId`: a string uses that resume draft, null uses none, and undefined
 * picks the job's most recently approved draft if there is one.
 */
export async function loadCoverInputs(db: Database, userId: string, jobId: string, draftId?: string | null): Promise<CoverInputs> {
  const [job] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)));
  if (!job) throw new CoverLetterError("That job wasn't found.");

  let draft: Draft | null = null;
  if (draftId) {
    draft = await findBaseDraft(db, userId, jobId, draftId);
    if (!draft) throw new CoverLetterError("That resume draft wasn't found for this job.");
  } else if (draftId === undefined) {
    const [approved] = await db
      .select()
      .from(resumeDrafts)
      .where(and(eq(resumeDrafts.userId, userId), eq(resumeDrafts.jobId, jobId), eq(resumeDrafts.status, "approved")))
      .orderBy(desc(resumeDrafts.approvedAt), desc(resumeDrafts.updatedAt))
      .limit(1);
    draft = approved ?? null;
  }

  const [requirements, library] = await Promise.all([
    db
      .select()
      .from(jobRequirements)
      .where(and(eq(jobRequirements.jobId, jobId), eq(jobRequirements.userId, userId)))
      .orderBy(asc(jobRequirements.position)),
    loadLibrary(db, userId),
  ]);
  return { job, requirements, draft, context: buildLibraryContext(library) };
}

const LABEL_TEXT = { strong: "strong evidence", transferable: "transferable", gap: "gap — nothing in the library supports it" } as const;

function aliasesFor(ids: string[], context: LibraryContext): string[] {
  return ids.map((id) => context.achievementAlias.get(id)).filter((alias): alias is string => Boolean(alias));
}

/** The user message: the job, how the library matches it, and the tone. */
export function coverLetterContent(inputs: CoverInputs, tone: CoverTone): string {
  const { job, requirements, draft, context } = inputs;
  const out: string[] = ["# Job"];
  out.push(`Company: ${job.company || "(not given)"}`, `Title: ${job.title || "(not given)"}`);
  if (job.location) out.push(`Location: ${job.location}${job.remoteType !== "unknown" ? ` (${job.remoteType})` : ""}`);
  if (job.analysis) {
    if (job.analysis.summary) out.push(`Summary: ${job.analysis.summary}`);
    if (job.analysis.seniority) out.push(`Seniority: ${job.analysis.seniority}`);
    if (job.analysis.responsibilities.length) out.push("Responsibilities:", ...job.analysis.responsibilities.map((item) => `- ${item}`));
  }

  if (requirements.length) {
    out.push("", "# Requirements and how the library supports them");
    for (const requirement of requirements) {
      const aliases = aliasesFor(requirement.achievementIds, context);
      const label = requirement.label ? LABEL_TEXT[requirement.label] : "not matched yet";
      const parts = [`- [${requirement.kind}] ${requirement.text} → ${label}`];
      if (aliases.length && requirement.label !== "gap") parts.push(`achievements: ${aliases.join(", ")}`);
      if (requirement.translation && requirement.label === "transferable") parts.push(`framing: ${requirement.translation}`);
      out.push(parts.join(" · "));
    }
  }

  if (draft?.summary.trim()) out.push("", "# Resume summary this letter goes with", draft.summary.trim());

  const posting = job.postingText.trim();
  if (posting) {
    out.push("", "# Posting text (context about the company and role only — not facts about the candidate)", "<<<", posting.slice(0, 8000), ">>>");
  }

  out.push("", "# Task", `Write the letter body in a ${TONES[tone]} tone.`);
  return out.join("\n");
}

/** Deterministic stand-in used when AI_FAKE=1. */
export function fakeCoverLetter(inputs: CoverInputs, tone: CoverTone): CoverLetterOutput {
  const { job, requirements, draft, context } = inputs;
  const company = job.company || "your team";
  const title = job.title || "this role";
  const ranked = [
    ...requirements.filter((r) => r.label === "strong"),
    ...requirements.filter((r) => r.label === "transferable"),
  ].flatMap((r) => aliasesFor(r.achievementIds, context));
  const aliases = [...new Set([...ranked, ...context.achievementByAlias.keys()])].slice(0, 3);
  const story = (alias: string) => {
    const achievement = context.achievementByAlias.get(alias);
    if (!achievement) return "";
    const role = [...context.roleByAlias.values()].find((item) => item.id === achievement.roleId);
    const where = role ? ` at ${role.employer}` : "";
    const outcome = achievement.outcome ? ` ${achievement.outcome.replace(/\.?$/, ".")}` : "";
    return `One example${where}: ${achievement.headline.replace(/\.$/, "")}.${outcome}`;
  };

  const opening = `I'm applying for the ${title} role at ${company}. ${draft?.summary.trim() || "My work so far has been coaching people and running programs they had to adopt and stick with, which is the core of this job."}`;
  const paragraphs: CoverLetterOutput["paragraphs"] = [{ text: opening, evidence: [] }];
  if (aliases[0]) {
    // The fake cites one alias that doesn't exist, so tests cover the drop path.
    paragraphs.push({ text: `${story(aliases[0])} That is the same work as helping a customer reach value early.`, evidence: [aliases[0], "A999"] });
  }
  if (aliases.length > 1) {
    const rest = aliases.slice(1);
    paragraphs.push({ text: `${rest.map(story).join(" ")} I kept people informed and moving without formal authority.`, evidence: rest.map((alias) => alias.toLowerCase()) });
  }
  const close = {
    warm: `I'd enjoy talking about how this would carry over to ${company}.`,
    direct: `I can start by learning your customers and onboarding. Happy to talk.`,
    formal: `I would welcome the opportunity to discuss the role with ${company}.`,
  }[tone];
  paragraphs.push({ text: close, evidence: [] });
  return { paragraphs };
}

/** Claude's paragraphs with aliases mapped to achievement ids; invented aliases are dropped. */
export function resolveParagraphs(output: CoverLetterOutput, context: LibraryContext): EvidencedText[] {
  return output.paragraphs
    .map((paragraph) => ({ text: paragraph.text.trim(), evidence: resolveAliases(paragraph.evidence, context.achievementByAlias) }))
    .filter((paragraph) => paragraph.text.length > 0);
}

export async function draftCoverLetter(
  db: Database,
  userId: string,
  jobId: string,
  options: { draftId?: string | null; tone?: string } = {},
): Promise<CoverLetter> {
  const tone = normalizeTone(options.tone);
  const inputs = await loadCoverInputs(db, userId, jobId, options.draftId);
  const result = await runStructured({
    userId,
    task: "cover",
    promptVersion: PROMPT_VERSION,
    schema: coverLetterSchema,
    context: inputs.context.text,
    instructions: INSTRUCTIONS,
    content: coverLetterContent(inputs, tone),
    effort: "high",
    refId: jobId,
    fake: () => fakeCoverLetter(inputs, tone),
  });
  return createCoverLetter(db, userId, {
    jobId,
    draftId: inputs.draft?.id ?? null,
    paragraphs: resolveParagraphs(result.output, inputs.context),
    model: result.model,
    promptVersion: result.promptVersion,
  });
}
