import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/db";
import { EVIDENCE_LABELS, jobRequirements, jobs, type EvidenceLabel } from "@/db/schema";
import { buildLibraryContext, loadLibrary, resolveAliases, type Achievement } from "@/lib/ai/library";
import { runStructured } from "@/lib/ai/run";
import { JobError, listRequirements, requireJob, type JobRequirement } from "@/lib/jobs/jobs";

/*
 * Requirement → evidence. Claude sees requirements as Q-aliases and the
 * library's achievements as A-aliases; anything it cites that isn't in the
 * library is dropped, and a "strong"/"transferable" call left with no real
 * evidence becomes a gap. Rows the owner labelled themselves are never touched.
 */

export const PROMPT_VERSION = "match@1";

export const matchSchema = z.object({
  matches: z.array(
    z.object({
      requirement: z.string().describe("The requirement alias, e.g. Q3."),
      label: z.enum(EVIDENCE_LABELS),
      achievementIds: z.array(z.string()).describe("Achievement aliases from the library (A1, A2…), strongest first. [] for a gap."),
      rationale: z.string().describe("One sentence: why this evidence supports the requirement, or what's missing."),
      translation: z.string().describe("Transferable only: how the experience maps into this job's business language. \"\" otherwise."),
    }),
  ),
});

export type MatchOutput = z.infer<typeof matchSchema>;

const INSTRUCTIONS = `Match each job requirement (Q1, Q2…) in the user message to evidence in the career library.

- "strong": an achievement shows this directly — the same kind of work, audience or tool.
- "transferable": achievements show the underlying skill in a different setting (for example coaching clients through a program → guiding customers through onboarding).
- "gap": nothing in the library supports it. Don't stretch.
- achievementIds: the library's achievement aliases (A1, A2…) that support the label, strongest first, at most 3. Cite only aliases that appear in the library. [] for a gap.
- rationale: one sentence — why this evidence supports the requirement, or what's missing.
- translation: only for "transferable". One sentence on how the coaching, program or stakeholder experience maps into the job's business language (e.g. "client retention" → "customer retention and renewals"). Don't claim formal SaaS experience unless a role marked "SaaS: yes" supports it. "" for strong and gap.

Return one entry per requirement, in order.`;

export type MatchTarget = { id: string; alias: string; text: string; kind: JobRequirement["kind"] };

export type MatchUpdate = {
  id: string;
  label: EvidenceLabel | null;
  achievementIds: string[];
  rationale: string;
  translation: string;
};

const UNSUPPORTED = "No achievement from your library was cited for this, so it's treated as a gap.";

/** Maps Claude's answer back onto requirement rows, dropping invented aliases. */
export function applyMatches(targets: MatchTarget[], output: MatchOutput, achievementByAlias: Map<string, { id: string }>): MatchUpdate[] {
  const byAlias = new Map<string, MatchOutput["matches"][number]>();
  for (const match of output.matches) {
    const alias = match.requirement.trim().toUpperCase();
    if (!byAlias.has(alias)) byAlias.set(alias, match);
  }
  return targets.map((target) => {
    const match = byAlias.get(target.alias);
    if (!match) return { id: target.id, label: null, achievementIds: [], rationale: "", translation: "" };
    const ids = resolveAliases(match.achievementIds, achievementByAlias);
    if (match.label === "gap" || ids.length === 0) {
      return { id: target.id, label: "gap", achievementIds: [], rationale: match.label === "gap" ? match.rationale.trim() : UNSUPPORTED, translation: "" };
    }
    return {
      id: target.id,
      label: match.label,
      achievementIds: ids,
      rationale: match.rationale.trim(),
      translation: match.label === "transferable" ? match.translation.trim() : "",
    };
  });
}

/* ---------- Deterministic stand-in for Claude (AI_FAKE=1) ---------- */

const STOP = new Set(
  "the and for with you your our are will who from that this have has into across able ability experience years year strong work working including etc plus using use per all any can other more than within about their them they its it's not but also such via well who".split(" "),
);

export function meaningfulWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9+#]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );
}

function achievementText(a: Achievement) {
  return [a.headline, a.action, a.audience, a.scale, a.collaborators, a.outcome, a.tools.join(" "), a.tags.join(" ")].join(" ");
}

/** Keyword overlap: ≥2 shared meaningful words → strong, 1 → transferable, 0 → gap. */
export function fakeMatch(targets: MatchTarget[], achievementByAlias: Map<string, Achievement>): MatchOutput {
  const library = [...achievementByAlias.entries()].map(([alias, a]) => ({ alias, a, words: meaningfulWords(achievementText(a)) }));
  return {
    matches: targets.map((target) => {
      const words = meaningfulWords(target.text);
      const scored = library
        .map((item) => ({ ...item, shared: [...words].filter((w) => item.words.has(w)) }))
        .filter((item) => item.shared.length > 0)
        .sort((x, y) => y.shared.length - x.shared.length);
      const best = scored[0];
      if (!best) return { requirement: target.alias, label: "gap" as const, achievementIds: [], rationale: "No achievement in your library mentions this.", translation: "" };
      const label = best.shared.length >= 2 ? ("strong" as const) : ("transferable" as const);
      return {
        requirement: target.alias,
        label,
        achievementIds: scored.slice(0, 3).map((item) => item.alias),
        rationale: `“${best.a.headline}” shares: ${best.shared.slice(0, 4).join(", ")}.`,
        translation: label === "transferable" ? `Describe “${best.a.headline}” in this job's terms: ${target.text}` : "",
      };
    }),
  };
}

/* ---------- Task ---------- */

export async function matchEvidence(db: Database, userId: string, jobId: string) {
  const job = await requireJob(db, userId, jobId);
  if (!job.analyzedAt) throw new JobError("Analyze the posting first — matching needs its requirements.");

  const requirements = await listRequirements(db, userId, job.id);
  const targets: MatchTarget[] = requirements
    .filter((r) => r.kind !== "screening" && !r.labelOverridden)
    .map((r, index) => ({ id: r.id, alias: `Q${index + 1}`, text: r.text, kind: r.kind }));

  const counts = { strong: 0, transferable: 0, gap: 0, skipped: requirements.filter((r) => r.labelOverridden).length };
  if (targets.length) {
    const context = buildLibraryContext(await loadLibrary(db, userId));
    if (!context.shared.length) throw new JobError("Add achievements to your library first — there's nothing to match against yet.");

    const result = await runStructured({
      userId,
      task: "match",
      promptVersion: PROMPT_VERSION,
      schema: matchSchema,
      context: context.text,
      instructions: INSTRUCTIONS,
      content: [
        `Job: ${job.title || "Untitled role"}${job.company ? ` at ${job.company}` : ""}`,
        "Requirements:",
        ...targets.map((t) => `${t.alias} (${t.kind}): ${t.text}`),
      ].join("\n"),
      effort: "high",
      refId: job.id,
      fake: () => fakeMatch(targets, context.achievementByAlias),
    });

    for (const update of applyMatches(targets, result.output, context.achievementByAlias)) {
      if (update.label) counts[update.label] += 1;
      await db
        .update(jobRequirements)
        .set({ label: update.label, achievementIds: update.achievementIds, rationale: update.rationale, translation: update.translation })
        // Re-checks the override flag in case the owner changed it mid-run.
        .where(and(eq(jobRequirements.id, update.id), eq(jobRequirements.userId, userId), eq(jobRequirements.labelOverridden, false)));
    }
  }

  await db.update(jobs).set({ matchedAt: new Date(), updatedAt: new Date() }).where(and(eq(jobs.id, job.id), eq(jobs.userId, userId)));
  return counts;
}
