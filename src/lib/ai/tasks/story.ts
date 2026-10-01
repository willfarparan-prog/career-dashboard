import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/db";
import { achievements } from "@/db/schema";
import { COMPETENCIES, COMPETENCY_KEYS } from "@/content/interview/competencies";
import { buildLibraryContext, loadLibrary } from "@/lib/ai/library";
import { runStructured } from "@/lib/ai/run";
import { InterviewInputError } from "@/lib/interview/stories";

/*
 * Turns one achievement into a STAR interview story. The draft only fills in
 * the story form: nothing is saved until the owner edits and submits it.
 * What the achievement doesn't say comes back as questions, not invention.
 */

export const PROMPT_VERSION = "story@1";

export const storySchema = z.object({
  title: z.string().describe("A short label for the story, 3–8 words."),
  situation: z.string(),
  task: z.string(),
  action: z.string(),
  result: z.string(),
  competencies: z.array(z.enum(COMPETENCY_KEYS)).describe("1–3 competency keys this story answers best."),
  openQuestions: z.array(z.string()).describe("Details the library doesn't give that would make the story stronger, as questions to the candidate."),
});
export type StoryDraft = z.infer<typeof storySchema>;

const INSTRUCTIONS = `Turn one achievement from the career library into an interview story in STAR form (Situation, Task, Action, Result), as the candidate would tell it aloud.

- Use only facts from that achievement and its role. Never invent numbers, names, tools, scale or outcomes.
- Use a number only if it is in the achievement; hedge approximate ones ("about"). Leave out numbers whose status is needs_confirmation.
- First person, past tense, plain spoken English. Situation and Task: one or two sentences each. Action: the longest part, 3–5 sentences of what the candidate personally did. Result: what changed, and what the candidate learned if no outcome is recorded.
- Keep coaching terms honest. Where a business term fits genuinely (adherence → adoption, intake → discovery), you may use it, but don't imply software or SaaS experience.
- Tag 1–3 competencies from the list given.
- In openQuestions, ask for what is missing that interviewers will probe: a result metric, the scale, the timeline, who else was involved. Return [] if nothing is missing.`;

function competencyList() {
  return COMPETENCIES.map((c) => `- ${c.key}: ${c.label}`).join("\n");
}

export async function draftStory(db: Database, userId: string, achievementId: string): Promise<{ draft: StoryDraft; achievementId: string }> {
  const [achievement] = await db.select().from(achievements).where(and(eq(achievements.id, achievementId), eq(achievements.userId, userId)));
  if (!achievement) throw new InterviewInputError("That achievement wasn't found.");
  const context = buildLibraryContext(await loadLibrary(db, userId));
  const alias = context.achievementAlias.get(achievement.id);
  if (!alias) throw new InterviewInputError("That achievement is private. Allow private facts in Settings, or mark it another status first.");

  const result = await runStructured({
    userId,
    task: "story",
    promptVersion: PROMPT_VERSION,
    schema: storySchema,
    context: context.text,
    instructions: INSTRUCTIONS,
    content: `Achievement to turn into a story: ${alias}\n\nCompetencies (use these keys only):\n${competencyList()}`,
    effort: "medium",
    refId: achievement.id,
    fake: () => ({
      title: achievement.headline.split(/\s+/).slice(0, 8).join(" "),
      situation: achievement.audience ? `I was working with ${achievement.audience}.` : "",
      task: achievement.headline,
      action: achievement.action || achievement.headline,
      result: achievement.outcome || "",
      competencies: ["drove-adoption"],
      openQuestions: achievement.outcome ? [] : ["What changed as a result, and how did you know?"],
    }),
  });
  return { draft: result.output, achievementId: achievement.id };
}
