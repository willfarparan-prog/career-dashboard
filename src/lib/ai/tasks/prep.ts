import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/db";
import { jobRequirements, jobs, type PrepContent } from "@/db/schema";
import { COMPETENCIES, COMPETENCY_KEYS, competency } from "@/content/interview/competencies";
import { buildLibraryContext, loadLibrary, resolveAliases, type LibraryContext } from "@/lib/ai/library";
import { runStructured } from "@/lib/ai/run";
import { savePrepContent, type InterviewPrep } from "@/lib/interview/prep";
import { InterviewInputError, listStories, storyText, type Story } from "@/lib/interview/stories";

/*
 * An interview prep pack for one job: the questions this posting is likely to
 * produce, which of the owner's stories answer each, honest framing where a
 * requirement is a gap, questions to ask, and what to research. Claude is told
 * not to state facts about the company — the checklist says what to look up.
 */

export const PROMPT_VERSION = "prep@1";

export const prepSchema = z.object({
  likelyQuestions: z.array(
    z.object({
      question: z.string(),
      why: z.string().describe("The requirement or posting line that makes this likely, in a few words."),
      competency: z.enum(COMPETENCY_KEYS).nullable(),
      storyAliases: z.array(z.string()).describe("Up to 2 story aliases (S1, S2…) that answer it best. [] when none fits."),
      gapAdvice: z.string().nullable().describe("Only when the question touches a gap: how to answer honestly. Otherwise null."),
    }),
  ),
  questionsToAsk: z.array(z.string()),
  researchChecklist: z.array(z.string()),
  pivotAngle: z.string(),
});
export type PrepOutput = z.infer<typeof prepSchema>;

const INSTRUCTIONS = `Prepare a candidate for interviews for one job. The career library is the only source of facts about the candidate; the posting is the only source about the job.

likelyQuestions: 8–12 questions this posting is likely to produce. Mix the three openers (tell me about yourself, why this path, why leave their current field), behavioral questions tied to the most important requirements, any screening questions, and one or two role scenarios (for example "How would you run a QBR for a customer whose usage dropped?"). For each:
- why: the requirement or posting line behind it.
- competency: the best-fitting key from the list, or null.
- storyAliases: up to 2 stories from the story list that answer it. Use only aliases from that list; [] if none fits.
- gapAdvice: only when it touches a requirement labeled gap. One or two sentences on answering honestly: acknowledge it, point to the nearest real experience, and say how they're closing it. Never suggest claiming the experience.

questionsToAsk: 5–7 sharp questions for the interviewers that this posting raises (for example how success is measured, book size and segment, who owns renewals, how onboarding hands off). No generic ones like "what's the culture like".

researchChecklist: 4–6 things to look up before the interview (the product, customers, recent news, the interviewers' backgrounds, the CS model). Say what to find out. Never state facts about the company yourself.

pivotAngle: 2–3 sentences on how this candidate should frame their career change for this specific job, using only library facts.

Honesty: never invent experience, numbers, tools or employers. Don't imply SaaS or software experience unless a role is marked "SaaS: yes".`;

type Job = typeof jobs.$inferSelect;
type Requirement = typeof jobRequirements.$inferSelect;

export type PrepInputs = { job: Job; requirements: Requirement[]; stories: Story[]; context: LibraryContext; storyByAlias: Map<string, Story> };

export async function loadPrepInputs(db: Database, userId: string, jobId: string): Promise<PrepInputs> {
  const [job] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)));
  if (!job) throw new InterviewInputError("That job wasn't found.");
  const [requirements, library, stories] = await Promise.all([
    db
      .select()
      .from(jobRequirements)
      .where(and(eq(jobRequirements.jobId, jobId), eq(jobRequirements.userId, userId)))
      .orderBy(asc(jobRequirements.position)),
    loadLibrary(db, userId),
    listStories(db, userId),
  ]);
  const context = buildLibraryContext(library);
  // Private stories stay out unless the owner sends private facts to Claude.
  const shared = library.profile?.sendPrivateToClaude ? stories : stories.filter((story) => story.factStatus !== "private");
  const storyByAlias = new Map(shared.map((story, index) => [`S${index + 1}`, story]));
  return { job, requirements, stories: shared, context, storyByAlias };
}

const LABEL_TEXT = { strong: "strong evidence", transferable: "transferable", gap: "GAP — nothing in the library supports it" } as const;

export function prepContent(inputs: PrepInputs): string {
  const { job, requirements, context, storyByAlias } = inputs;
  const out = ["# Job", `Company: ${job.company || "(not given)"}`, `Title: ${job.title || "(not given)"}`];
  if (job.analysis?.summary) out.push(`Summary: ${job.analysis.summary}`);
  if (job.analysis?.seniority) out.push(`Seniority: ${job.analysis.seniority}`);
  if (job.analysis?.responsibilities.length) out.push("Responsibilities:", ...job.analysis.responsibilities.map((item) => `- ${item}`));

  if (requirements.length) {
    out.push("", "# Requirements and how the library supports them");
    for (const r of requirements) {
      const aliases = r.achievementIds.map((id) => context.achievementAlias.get(id)).filter(Boolean);
      const label = r.label ? LABEL_TEXT[r.label] : "not matched yet";
      out.push(`- [${r.kind}] ${r.text} → ${label}${aliases.length && r.label !== "gap" ? ` · achievements: ${aliases.join(", ")}` : ""}`);
    }
  }

  out.push("", "# The candidate's stories");
  if (!storyByAlias.size) out.push("(none yet — use [] for storyAliases)");
  for (const [alias, story] of storyByAlias) {
    const based = story.achievementId ? context.achievementAlias.get(story.achievementId) : undefined;
    out.push(`[${alias}] ${story.title}${based ? ` (from ${based})` : ""} · competencies: ${story.competencies.join(", ") || "none"}`);
    out.push(...storyText(story).split("\n").map((line) => `    ${line}`));
  }

  out.push("", "# Competency keys", ...COMPETENCIES.map((c) => `- ${c.key}: ${c.label}`));

  const posting = job.postingText.trim();
  if (posting) out.push("", "# Posting text (about the job only — not facts about the candidate)", "<<<", posting.slice(0, 8000), ">>>");
  return out.join("\n");
}

/** Deterministic stand-in used when AI_FAKE=1. */
export function fakePrep(inputs: PrepInputs): PrepOutput {
  const aliases = [...inputs.storyByAlias.keys()];
  const asks = inputs.requirements.filter((r) => r.kind === "must" || r.kind === "responsibility" || r.kind === "screening").slice(0, 6);
  return {
    likelyQuestions: [
      { question: "Tell me about yourself.", why: "Every first round opens with it.", competency: "tell-me-about-yourself", storyAliases: [], gapAdvice: null },
      ...asks.map((r) => ({
        question: r.kind === "screening" ? r.text : `Tell me about a time you showed this: ${r.text}`,
        why: r.text,
        competency: null,
        // The fake cites one story that doesn't exist, so tests cover the drop path.
        storyAliases: aliases.length ? [aliases[0], "S999"] : [],
        gapAdvice: r.label === "gap" ? "(fake mode) Say plainly you haven't done this yet, point to the closest thing you have, and how you're learning it." : null,
      })),
    ],
    questionsToAsk: ["How is success measured for this role in the first 90 days?", "How many accounts would I own, and in which segment?", "Who owns renewals?"],
    researchChecklist: ["What the product does and who buys it", "The company's customer segments", "Your interviewers' backgrounds on LinkedIn"],
    pivotAngle: "(fake mode) Frame coaching as getting people to adopt and stick with a program, which is the core of this role.",
  };
}

export function resolvePrep(output: PrepOutput, inputs: PrepInputs): PrepContent {
  return {
    likelyQuestions: output.likelyQuestions
      .filter((q) => q.question.trim())
      .map((q) => ({
        question: q.question.trim(),
        why: q.why.trim(),
        competency: q.competency && competency(q.competency) ? q.competency : null,
        storyIds: resolveAliases(q.storyAliases, inputs.storyByAlias),
        gapAdvice: q.gapAdvice?.trim() || null,
      })),
    questionsToAsk: output.questionsToAsk.map((q) => q.trim()).filter(Boolean),
    researchChecklist: output.researchChecklist.map((q) => q.trim()).filter(Boolean),
    pivotAngle: output.pivotAngle.trim(),
  };
}

export async function generatePrep(db: Database, userId: string, jobId: string): Promise<InterviewPrep> {
  const inputs = await loadPrepInputs(db, userId, jobId);
  const result = await runStructured({
    userId,
    task: "prep",
    promptVersion: PROMPT_VERSION,
    schema: prepSchema,
    context: inputs.context.text,
    instructions: INSTRUCTIONS,
    content: prepContent(inputs),
    effort: "high",
    refId: jobId,
    fake: () => fakePrep(inputs),
  });
  return savePrepContent(db, userId, jobId, resolvePrep(result.output, inputs), { model: result.model, promptVersion: result.promptVersion });
}
