import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db";
import {
  jobRequirements,
  jobs,
  qualityFindings,
  resumeBullets,
  resumeDrafts,
  type BulletState,
  type CareerPath,
} from "@/db/schema";
import { buildLibraryContext, loadLibrary, resolveAliases, type Library, type LibraryContext } from "@/lib/ai/library";
import { libraryDraft, runDraft, type DraftOutput, PROMPT_VERSION as DRAFT_PROMPT } from "@/lib/ai/tasks/draft";
import { runRegenerate, type RegenerateControls } from "@/lib/ai/tasks/regenerate";
import { runReview } from "@/lib/ai/tasks/review";
import { findingKey, runTruthChecks } from "@/lib/checks/truth";

export class DraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftError";
  }
}

export type Draft = typeof resumeDrafts.$inferSelect;
export type Bullet = typeof resumeBullets.$inferSelect;
export type DraftFinding = typeof qualityFindings.$inferSelect;
type Job = typeof jobs.$inferSelect;

async function ownedJob(db: Database, userId: string, jobId: string): Promise<Job> {
  const [job] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)));
  if (!job) throw new DraftError("Job not found.");
  return job;
}

async function ownedDraft(db: Database, userId: string, draftId: string): Promise<Draft> {
  const [draft] = await db.select().from(resumeDrafts).where(and(eq(resumeDrafts.id, draftId), eq(resumeDrafts.userId, userId)));
  if (!draft) throw new DraftError("Draft not found.");
  return draft;
}

async function ownedBullet(db: Database, userId: string, bulletId: string): Promise<Bullet> {
  const [bullet] = await db.select().from(resumeBullets).where(and(eq(resumeBullets.id, bulletId), eq(resumeBullets.userId, userId)));
  if (!bullet) throw new DraftError("Bullet not found.");
  return bullet;
}

/** Any edit sends an approved draft back to draft status. */
async function touchDraft(db: Database, draftId: string) {
  await db.update(resumeDrafts).set({ status: "draft", approvedAt: null, updatedAt: new Date() }).where(eq(resumeDrafts.id, draftId));
}

export const jobLine = (job: Pick<Job, "title" | "company">) => [job.title || "Untitled role", job.company].filter(Boolean).join(" at ");

export type DraftSummary = Draft & { bulletCount: number; proposedCount: number; openErrors: number };

export async function listDraftsForJob(db: Database, userId: string, jobId: string): Promise<DraftSummary[]> {
  const drafts = await db
    .select()
    .from(resumeDrafts)
    .where(and(eq(resumeDrafts.userId, userId), eq(resumeDrafts.jobId, jobId)))
    .orderBy(asc(resumeDrafts.createdAt));
  if (!drafts.length) return [];
  const ids = drafts.map((d) => d.id);
  const [bullets, findings] = await Promise.all([
    db.select({ draftId: resumeBullets.draftId, state: resumeBullets.state }).from(resumeBullets).where(inArray(resumeBullets.draftId, ids)),
    db
      .select({ draftId: qualityFindings.draftId })
      .from(qualityFindings)
      .where(and(inArray(qualityFindings.draftId, ids), eq(qualityFindings.severity, "error"), eq(qualityFindings.resolved, false))),
  ]);
  return drafts.map((draft) => ({
    ...draft,
    bulletCount: bullets.filter((b) => b.draftId === draft.id && b.state !== "rejected").length,
    proposedCount: bullets.filter((b) => b.draftId === draft.id && b.state === "proposed").length,
    openErrors: findings.filter((f) => f.draftId === draft.id).length,
  }));
}

async function draftJobInput(db: Database, job: Job, context: LibraryContext) {
  const requirements = await db.select().from(jobRequirements).where(eq(jobRequirements.jobId, job.id)).orderBy(asc(jobRequirements.position));
  return {
    company: job.company,
    title: job.title,
    summary: job.analysis?.summary ?? "",
    requirements: requirements
      .filter((r) => r.kind !== "screening")
      .map((r) => ({
        kind: r.kind,
        text: r.text,
        label: r.label,
        achievements: r.achievementIds.map((id) => context.achievementAlias.get(id)).filter((alias): alias is string => Boolean(alias)),
        translation: r.translation,
      })),
  };
}

/**
 * Stores a draft from structured output. Aliases Claude made up are dropped;
 * a bullet sits under the role its achievement belongs to, whatever role it
 * was written under, so the resume can't move work between employers.
 */
export async function saveDraftOutput(
  db: Database,
  userId: string,
  args: { jobId: string | null; name: string; careerPath: CareerPath; output: DraftOutput; context: LibraryContext; model: string; promptVersion: string },
): Promise<string> {
  const { output, context } = args;
  const roleOrder = [...context.roleByAlias.values()].map((role) => role.id);
  const [draft] = await db
    .insert(resumeDrafts)
    .values({
      userId,
      jobId: args.jobId,
      name: args.name,
      careerPath: args.careerPath,
      summary: output.summary.text.trim(),
      summaryEvidence: resolveAliases(output.summary.evidence, context.achievementByAlias),
      skills: output.skills
        .map((skill) => ({ name: skill.name.trim(), evidence: resolveAliases(skill.evidence, context.achievementByAlias) }))
        .filter((skill) => skill.name),
      roleOrder,
      model: args.model,
      promptVersion: args.promptVersion,
    })
    .returning();

  const rows: Array<typeof resumeBullets.$inferInsert> = [];
  let position = 0;
  for (const roleBlock of output.roles) {
    const writtenUnder = context.roleByAlias.get(roleBlock.role.trim().toUpperCase());
    for (const bullet of roleBlock.bullets) {
      const text = bullet.text.trim();
      if (!text) continue;
      const achievement = bullet.achievement ? context.achievementByAlias.get(bullet.achievement.trim().toUpperCase()) : undefined;
      const achievementRole = achievement?.roleId && roleOrder.includes(achievement.roleId) ? achievement.roleId : null;
      rows.push({
        userId,
        draftId: draft.id,
        roleId: achievementRole ?? writtenUnder?.id ?? null,
        achievementId: achievement?.id ?? null,
        text,
        originalText: text,
        state: "proposed",
        position: position++,
      });
    }
  }
  if (rows.length) await db.insert(resumeBullets).values(rows);

  const notes = output.notes.map((note) => note.trim()).filter(Boolean).slice(0, 5);
  if (notes.length) {
    await db.insert(qualityFindings).values(
      notes.map((message) => ({ userId, draftId: draft.id, kind: "note", severity: "info" as const, message, source: "claude" as const })),
    );
  }
  await runChecks(db, userId, draft.id);
  return draft.id;
}

export async function generateDraft(
  db: Database,
  userId: string,
  jobId: string,
  options: { careerPath?: CareerPath; emphasis?: string; useClaude: boolean },
): Promise<string> {
  const job = await ownedJob(db, userId, jobId);
  const library = await loadLibrary(db, userId);
  if (!library.roles.length && !library.achievements.length) throw new DraftError("Your career library is empty. Import your resume or add achievements first.");
  const context = buildLibraryContext(library);
  const careerPath = options.careerPath ?? job.careerPath;
  const headline = library.profile?.headline ?? "";
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(resumeDrafts)
    .where(and(eq(resumeDrafts.userId, userId), eq(resumeDrafts.jobId, jobId)));
  const name = `${jobLine(job)} — v${Number(count) + 1}`;

  if (!options.useClaude) {
    return saveDraftOutput(db, userId, { jobId, name, careerPath, output: libraryDraft(context, headline), context, model: "library", promptVersion: "library@1" });
  }
  const result = await runDraft({ userId, context, job: await draftJobInput(db, job, context), careerPath, emphasis: options.emphasis ?? "", headline, refId: jobId });
  return saveDraftOutput(db, userId, { jobId, name, careerPath, output: result.output, context, model: result.model, promptVersion: result.promptVersion ?? DRAFT_PROMPT });
}

export type DraftEditor = {
  draft: Draft;
  job: Job | null;
  bullets: Bullet[];
  findings: DraftFinding[];
  library: Library;
};

export async function loadDraftEditor(db: Database, userId: string, draftId: string): Promise<DraftEditor | null> {
  const [draft] = await db.select().from(resumeDrafts).where(and(eq(resumeDrafts.id, draftId), eq(resumeDrafts.userId, userId)));
  if (!draft) return null;
  const [bullets, findings, library, jobRows] = await Promise.all([
    db.select().from(resumeBullets).where(eq(resumeBullets.draftId, draftId)).orderBy(asc(resumeBullets.position)),
    db.select().from(qualityFindings).where(eq(qualityFindings.draftId, draftId)).orderBy(asc(qualityFindings.createdAt)),
    loadLibrary(db, userId),
    draft.jobId ? db.select().from(jobs).where(and(eq(jobs.id, draft.jobId), eq(jobs.userId, userId))) : Promise.resolve([]),
  ]);
  return { draft, job: jobRows[0] ?? null, bullets, findings, library };
}

/** Re-runs the rule checks. Findings the owner dismissed stay dismissed. */
export async function runChecks(db: Database, userId: string, draftId: string): Promise<number> {
  const draft = await ownedDraft(db, userId, draftId);
  const [bullets, library, existing] = await Promise.all([
    db.select().from(resumeBullets).where(eq(resumeBullets.draftId, draftId)),
    loadLibrary(db, userId),
    db.select().from(qualityFindings).where(and(eq(qualityFindings.draftId, draftId), eq(qualityFindings.source, "rule"))),
  ]);
  const dismissed = new Set(existing.filter((f) => f.resolved).map(findingKey));
  const findings = runTruthChecks({ summary: draft.summary, skills: draft.skills, roleOrder: draft.roleOrder, bullets, library });
  await db.delete(qualityFindings).where(and(eq(qualityFindings.draftId, draftId), eq(qualityFindings.source, "rule")));
  if (findings.length) {
    await db.insert(qualityFindings).values(
      findings.map((f) => ({ userId, draftId, bulletId: f.bulletId, kind: f.kind, severity: f.severity, message: f.message, suggestion: f.suggestion, source: "rule" as const, resolved: dismissed.has(findingKey(f)) })),
    );
  }
  await db.update(resumeDrafts).set({ checkedAt: new Date() }).where(eq(resumeDrafts.id, draftId));
  return findings.length;
}

export async function updateBulletText(db: Database, userId: string, bulletId: string, text: string) {
  const bullet = await ownedBullet(db, userId, bulletId);
  const clean = text.trim();
  if (!clean) throw new DraftError("A bullet can't be empty. Reject it instead.");
  // Owner-written wording counts as accepted (a locked bullet stays locked).
  await db
    .update(resumeBullets)
    .set({ text: clean, state: bullet.state === "locked" ? "locked" : "accepted", updatedAt: new Date() })
    .where(eq(resumeBullets.id, bulletId));
  await touchDraft(db, bullet.draftId);
  await runChecks(db, userId, bullet.draftId);
}

export async function setBulletState(db: Database, userId: string, bulletId: string, state: BulletState) {
  const bullet = await ownedBullet(db, userId, bulletId);
  await db.update(resumeBullets).set({ state, updatedAt: new Date() }).where(eq(resumeBullets.id, bulletId));
  await touchDraft(db, bullet.draftId);
  await runChecks(db, userId, bullet.draftId);
}

export async function revertBullet(db: Database, userId: string, bulletId: string) {
  const bullet = await ownedBullet(db, userId, bulletId);
  if (bullet.state === "locked") throw new DraftError("Unlock the bullet first.");
  await db.update(resumeBullets).set({ text: bullet.originalText, state: "proposed", updatedAt: new Date() }).where(eq(resumeBullets.id, bulletId));
  await touchDraft(db, bullet.draftId);
  await runChecks(db, userId, bullet.draftId);
}

export async function moveBullet(db: Database, userId: string, bulletId: string, direction: "up" | "down") {
  const bullet = await ownedBullet(db, userId, bulletId);
  const siblings = (await db.select().from(resumeBullets).where(eq(resumeBullets.draftId, bullet.draftId)).orderBy(asc(resumeBullets.position))).filter(
    (b) => b.roleId === bullet.roleId && b.state !== "rejected",
  );
  const index = siblings.findIndex((b) => b.id === bullet.id);
  const other = siblings[direction === "up" ? index - 1 : index + 1];
  if (index < 0 || !other) return;
  await db.update(resumeBullets).set({ position: other.position }).where(eq(resumeBullets.id, bullet.id));
  await db.update(resumeBullets).set({ position: bullet.position }).where(eq(resumeBullets.id, other.id));
  await touchDraft(db, bullet.draftId);
}

export async function addBulletFromAchievement(db: Database, userId: string, draftId: string, achievementId: string) {
  await ownedDraft(db, userId, draftId);
  const library = await loadLibrary(db, userId);
  const achievement = library.achievements.find((a) => a.id === achievementId);
  if (!achievement) throw new DraftError("Achievement not found.");
  const outcome = achievement.outcome.trim().replace(/\.$/, "");
  const base = (achievement.action || achievement.headline).trim().replace(/\.$/, "");
  const text = `${base.charAt(0).toUpperCase()}${base.slice(1)}${outcome ? `; ${outcome.charAt(0).toLowerCase()}${outcome.slice(1)}` : ""}.`;
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${resumeBullets.position}), -1)::int` }).from(resumeBullets).where(eq(resumeBullets.draftId, draftId));
  await db.insert(resumeBullets).values({ userId, draftId, roleId: achievement.roleId, achievementId, text, originalText: text, state: "accepted", position: Number(max) + 1 });
  await touchDraft(db, draftId);
  await runChecks(db, userId, draftId);
}

export async function updateSummary(db: Database, userId: string, draftId: string, text: string, locked: boolean) {
  await ownedDraft(db, userId, draftId);
  await db.update(resumeDrafts).set({ summary: text.trim(), summaryLocked: locked }).where(eq(resumeDrafts.id, draftId));
  await touchDraft(db, draftId);
  await runChecks(db, userId, draftId);
}

export async function updateSkills(db: Database, userId: string, draftId: string, names: string[]) {
  const draft = await ownedDraft(db, userId, draftId);
  const evidence = new Map(draft.skills.map((s) => [s.name.toLowerCase(), s.evidence]));
  const seen = new Set<string>();
  const skills = names
    .map((name) => name.trim())
    .filter((name) => name && !seen.has(name.toLowerCase()) && seen.add(name.toLowerCase()))
    .map((name) => ({ name, evidence: evidence.get(name.toLowerCase()) ?? [] }));
  await db.update(resumeDrafts).set({ skills }).where(eq(resumeDrafts.id, draftId));
  await touchDraft(db, draftId);
  await runChecks(db, userId, draftId);
}

export async function regenerateBullet(db: Database, userId: string, bulletId: string, controls: RegenerateControls) {
  const bullet = await ownedBullet(db, userId, bulletId);
  if (bullet.state === "locked") throw new DraftError("This bullet is locked. Unlock it to regenerate.");
  if (!bullet.achievementId) throw new DraftError("Link this bullet to an achievement before regenerating it.");
  const draft = await ownedDraft(db, userId, bullet.draftId);
  const context = buildLibraryContext(await loadLibrary(db, userId));
  const alias = context.achievementAlias.get(bullet.achievementId);
  if (!alias) throw new DraftError("That achievement is private or missing, so Claude can't see it.");
  const job = draft.jobId ? await ownedJob(db, userId, draft.jobId) : null;
  const result = await runRegenerate({ userId, context, achievementAlias: alias, currentText: bullet.text, jobLine: job ? jobLine(job) : "general resume", controls, refId: draft.id });
  const text = result.output.text.trim();
  if (!text) throw new DraftError("Claude returned an empty bullet. Try again.");
  await db.update(resumeBullets).set({ text, state: "proposed", controls, updatedAt: new Date() }).where(eq(resumeBullets.id, bulletId));
  await touchDraft(db, draft.id);
  await runChecks(db, userId, draft.id);
}

/** Claude's skeptical read of the draft. Replaces its previous review findings (keeps its drafting notes). */
export async function reviewDraft(db: Database, userId: string, draftId: string): Promise<number> {
  const draft = await ownedDraft(db, userId, draftId);
  const library = await loadLibrary(db, userId);
  const context = buildLibraryContext(library);
  const bullets = (await db.select().from(resumeBullets).where(eq(resumeBullets.draftId, draftId)).orderBy(asc(resumeBullets.position))).filter((b) => b.state !== "rejected");
  const job = draft.jobId ? await ownedJob(db, userId, draft.jobId) : null;
  const aliasToBullet = new Map<string, string>();
  const reviewBullets = bullets.map((b, index) => {
    const alias = `B${index + 1}`;
    aliasToBullet.set(alias, b.id);
    const role = library.roles.find((r) => r.id === b.roleId);
    return { alias, text: b.text, achievementAlias: b.achievementId ? (context.achievementAlias.get(b.achievementId) ?? null) : null, roleLine: role ? `${role.title} at ${role.employer}` : "no role" };
  });
  const result = await runReview({ userId, context, jobLine: job ? jobLine(job) : "general resume", summary: draft.summary, skills: draft.skills.map((s) => s.name), bullets: reviewBullets, refId: draftId });
  const existing = await db.select().from(qualityFindings).where(and(eq(qualityFindings.draftId, draftId), eq(qualityFindings.source, "claude")));
  const staleIds = existing.filter((f) => f.kind !== "note").map((f) => f.id);
  if (staleIds.length) await db.delete(qualityFindings).where(inArray(qualityFindings.id, staleIds));
  const rows = result.output.findings.map((f) => ({
    userId,
    draftId,
    bulletId: f.bullet ? (aliasToBullet.get(f.bullet.trim().toUpperCase()) ?? null) : null,
    kind: f.kind,
    severity: f.severity,
    message: f.message,
    suggestion: f.suggestion,
    source: "claude" as const,
  }));
  if (rows.length) await db.insert(qualityFindings).values(rows);
  return rows.length;
}

export async function setFindingResolved(db: Database, userId: string, findingId: string, resolved: boolean) {
  const [finding] = await db.select().from(qualityFindings).where(and(eq(qualityFindings.id, findingId), eq(qualityFindings.userId, userId)));
  if (!finding) throw new DraftError("Finding not found.");
  await db.update(qualityFindings).set({ resolved }).where(eq(qualityFindings.id, findingId));
}

/** Approval means every bullet was reviewed and no error-level finding is open. */
export async function approveDraft(db: Database, userId: string, draftId: string) {
  await ownedDraft(db, userId, draftId);
  await runChecks(db, userId, draftId);
  const [bullets, errors] = await Promise.all([
    db.select().from(resumeBullets).where(eq(resumeBullets.draftId, draftId)),
    db.select().from(qualityFindings).where(and(eq(qualityFindings.draftId, draftId), eq(qualityFindings.severity, "error"), eq(qualityFindings.resolved, false))),
  ]);
  const proposed = bullets.filter((b) => b.state === "proposed").length;
  const problems: string[] = [];
  if (proposed) problems.push(`${proposed} bullet${proposed === 1 ? "" : "s"} still need accepting or rejecting`);
  if (errors.length) problems.push(`${errors.length} error${errors.length === 1 ? "" : "s"} to fix or dismiss`);
  if (!bullets.some((b) => b.state === "accepted" || b.state === "locked")) problems.push("no accepted bullets yet");
  if (problems.length) throw new DraftError(`Not ready to approve: ${problems.join("; ")}.`);
  await db.update(resumeDrafts).set({ status: "approved", approvedAt: new Date(), updatedAt: new Date() }).where(eq(resumeDrafts.id, draftId));
}

export async function reopenDraft(db: Database, userId: string, draftId: string) {
  await ownedDraft(db, userId, draftId);
  await touchDraft(db, draftId);
}

export async function renameDraft(db: Database, userId: string, draftId: string, name: string) {
  await ownedDraft(db, userId, draftId);
  if (!name.trim()) throw new DraftError("Give the draft a name.");
  await db.update(resumeDrafts).set({ name: name.trim(), updatedAt: new Date() }).where(eq(resumeDrafts.id, draftId));
}

/** Copies a draft (and its bullets) so a submitted or approved version is never edited in place. */
export async function duplicateDraft(db: Database, userId: string, draftId: string): Promise<string> {
  const draft = await ownedDraft(db, userId, draftId);
  const bullets = await db.select().from(resumeBullets).where(eq(resumeBullets.draftId, draftId)).orderBy(asc(resumeBullets.position));
  const [copy] = await db
    .insert(resumeDrafts)
    .values({
      userId,
      jobId: draft.jobId,
      parentId: draft.id,
      name: `${draft.name} (copy)`,
      summary: draft.summary,
      summaryEvidence: draft.summaryEvidence,
      summaryLocked: draft.summaryLocked,
      skills: draft.skills,
      roleOrder: draft.roleOrder,
      careerPath: draft.careerPath,
      model: draft.model,
      promptVersion: draft.promptVersion,
    })
    .returning();
  if (bullets.length) {
    await db.insert(resumeBullets).values(
      bullets.map((b) => ({ userId, draftId: copy.id, roleId: b.roleId, achievementId: b.achievementId, text: b.text, originalText: b.originalText, state: b.state, controls: b.controls, position: b.position })),
    );
  }
  await runChecks(db, userId, copy.id);
  return copy.id;
}

export async function deleteDraft(db: Database, userId: string, draftId: string) {
  await ownedDraft(db, userId, draftId);
  await db.delete(resumeDrafts).where(and(eq(resumeDrafts.id, draftId), eq(resumeDrafts.userId, userId)));
}
