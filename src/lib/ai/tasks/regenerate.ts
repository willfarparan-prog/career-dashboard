import { z } from "zod";
import type { LibraryContext } from "@/lib/ai/library";
import { runStructured } from "@/lib/ai/run";

export const PROMPT_VERSION = "regenerate@1";

export const RegenerateSchema = z.object({ text: z.string() });

export const TONES = ["plain", "confident", "warm"] as const;
export const LENGTHS = ["shorter", "same", "longer"] as const;
export const EMPHASES = ["outcome", "scale", "customer impact", "collaboration", "tools", "program ownership"] as const;

export type RegenerateControls = { tone: string; length: string; emphasis: string };

const INSTRUCTIONS = `Rewrite one resume bullet from the achievement it is based on.

- Use only facts in that achievement. Keep every number exactly as recorded; add none.
- Don't imply a title, employer, SaaS or software experience the library doesn't support.
- Start with a strong verb; one sentence, about 30 words or fewer unless asked for longer.
- Follow the requested tone, length and emphasis. Return only the new bullet text.`;

export async function runRegenerate(args: {
  userId: string;
  context: LibraryContext;
  achievementAlias: string;
  currentText: string;
  jobLine: string;
  controls: RegenerateControls;
  refId?: string;
}) {
  const achievement = args.context.achievementByAlias.get(args.achievementAlias);
  return runStructured({
    userId: args.userId,
    task: "regenerate",
    promptVersion: PROMPT_VERSION,
    schema: RegenerateSchema,
    context: args.context.text,
    instructions: INSTRUCTIONS,
    content: [
      `Target job: ${args.jobLine}`,
      `Achievement: ${args.achievementAlias}`,
      `Current bullet: ${args.currentText}`,
      `Tone: ${args.controls.tone}. Length: ${args.controls.length}. Emphasis: ${args.controls.emphasis}.`,
    ].join("\n"),
    effort: "medium",
    refId: args.refId,
    fake: () => {
      const words = args.currentText.split(/\s+/).filter(Boolean);
      if (args.controls.length === "shorter") return { text: `${words.slice(0, Math.max(5, Math.ceil(words.length * 0.6))).join(" ").replace(/[.,;]$/, "")}.` };
      if (args.controls.length === "longer" && achievement?.audience) return { text: `${args.currentText.replace(/\.$/, "")} for ${achievement.audience}.` };
      return { text: args.currentText };
    },
  });
}
