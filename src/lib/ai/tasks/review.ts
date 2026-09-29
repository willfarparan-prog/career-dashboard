import { z } from "zod";
import type { LibraryContext } from "@/lib/ai/library";
import { runStructured } from "@/lib/ai/run";

export const PROMPT_VERSION = "review@1";

export const REVIEW_KINDS = ["vague", "inflated", "indefensible", "unsupported", "repetition", "tone", "other"] as const;

export const ReviewSchema = z.object({
  findings: z.array(
    z.object({
      bullet: z.string().nullable(),
      kind: z.enum(REVIEW_KINDS),
      severity: z.enum(["error", "warning", "info"]),
      message: z.string(),
      suggestion: z.string(),
    }),
  ),
});

const INSTRUCTIONS = `Review this tailored resume draft against the career library, like a skeptical interviewer.

Flag only real problems:
- unsupported: a claim the linked achievement (or the library) doesn't support.
- inflated: wording that overstates scope, seniority, ownership or SaaS/software experience.
- indefensible: a statement the candidate would struggle to explain with specifics in an interview.
- vague: filler that doesn't say what was done or what changed.
- repetition / tone / other: awkward repetition or wording that works against the target role.
Reference bullets by their alias (B1, B2…); use null for the summary or skills. Keep each message and suggestion to one sentence. Return an empty list if the draft is sound.`;

export type ReviewBullet = { alias: string; text: string; achievementAlias: string | null; roleLine: string };

export async function runReview(args: { userId: string; context: LibraryContext; jobLine: string; summary: string; skills: string[]; bullets: ReviewBullet[]; refId?: string }) {
  const content = [
    `Target job: ${args.jobLine}`,
    `Summary: ${args.summary || "(none)"}`,
    `Skills: ${args.skills.join(", ") || "(none)"}`,
    "Bullets:",
    ...args.bullets.map((b) => `[${b.alias}] (${b.roleLine}; based on ${b.achievementAlias ?? "no achievement"}) ${b.text}`),
  ].join("\n");
  return runStructured({
    userId: args.userId,
    task: "review",
    promptVersion: PROMPT_VERSION,
    schema: ReviewSchema,
    context: args.context.text,
    instructions: INSTRUCTIONS,
    content,
    effort: "medium",
    refId: args.refId,
    fake: () => ({
      findings: args.bullets
        .filter((b) => b.text.split(/\s+/).length > 30)
        .map((b) => ({ bullet: b.alias, kind: "vague" as const, severity: "info" as const, message: "(fake mode) Long bullet; tighten it.", suggestion: "Cut it to the action and the result." })),
    }),
  });
}
