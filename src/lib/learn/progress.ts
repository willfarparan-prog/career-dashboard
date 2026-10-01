import { and, eq, like } from "drizzle-orm";
import type { Database } from "@/db";
import { LEARNING_STATUSES, learningItems, type LearningStatus } from "@/db/schema";
import { GLOSSARY } from "@/content/learn/glossary";
import { isGuidePath } from "@/content/learn/guides";
import { RESOURCES } from "@/content/learn/resources";
import { GUIDE_SECTIONS, type GuidePath, type GuideSection } from "@/content/learn/types";

/*
 * Progress through the Learn hub. Keys name curated content, so a key that
 * doesn't resolve to a real term, resource or guide section is refused rather
 * than stored.
 */

export class LearnInputError extends Error {}

const TERM_KEYS = new Set(GLOSSARY.map((term) => term.key));
const RESOURCE_KEYS = new Set(RESOURCES.map((resource) => resource.key));

export const termKey = (key: string) => `term:${key}`;
export const resourceKey = (key: string) => `resource:${key}`;
export const guideKey = (path: GuidePath, section: GuideSection) => `guide:${path}:${section}`;

export function isKnownKey(key: string): boolean {
  const [kind, a, b, ...rest] = key.split(":");
  if (rest.length) return false;
  if (kind === "term") return b === undefined && TERM_KEYS.has(a);
  if (kind === "resource") return b === undefined && RESOURCE_KEYS.has(a);
  if (kind === "guide") return isGuidePath(a ?? "") && (GUIDE_SECTIONS as readonly string[]).includes(b ?? "");
  return false;
}

export function isLearningStatus(value: string): value is LearningStatus {
  return (LEARNING_STATUSES as readonly string[]).includes(value);
}

export type Progress = Map<string, LearningStatus>;

export async function listProgress(db: Database, userId: string): Promise<Progress> {
  const rows = await db.select({ key: learningItems.key, status: learningItems.status }).from(learningItems).where(eq(learningItems.userId, userId));
  return new Map(rows.map((row) => [row.key, row.status]));
}

/** Records a status for a piece of content, or clears it when `status` is null. */
export async function setProgress(db: Database, userId: string, key: string, status: LearningStatus | null): Promise<void> {
  if (!isKnownKey(key)) throw new LearnInputError("That item isn't in the Learn hub.");
  if (status === null) {
    await db.delete(learningItems).where(and(eq(learningItems.userId, userId), eq(learningItems.key, key)));
    return;
  }
  if (!isLearningStatus(status)) throw new LearnInputError("Pick learning, confident or done.");
  await db
    .insert(learningItems)
    .values({ userId, key, status })
    .onConflictDoUpdate({ target: [learningItems.userId, learningItems.key], set: { status, updatedAt: new Date() } });
}

/** True once any section of any field guide is marked done. */
export async function hasReadAGuide(db: Database, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: learningItems.id })
    .from(learningItems)
    .where(and(eq(learningItems.userId, userId), like(learningItems.key, "guide:%")))
    .limit(1);
  return rows.length > 0;
}

export type ProgressSummary = { termsKnown: number; termsTotal: number; sectionsDone: number; resourcesDone: number; resourcesStarted: number };

export function summarize(progress: Progress): ProgressSummary {
  let termsKnown = 0;
  let sectionsDone = 0;
  let resourcesDone = 0;
  let resourcesStarted = 0;
  for (const [key, status] of progress) {
    if (key.startsWith("term:") && status === "confident") termsKnown++;
    else if (key.startsWith("guide:") && status === "done") sectionsDone++;
    else if (key.startsWith("resource:")) {
      if (status === "done") resourcesDone++;
      else resourcesStarted++;
    }
  }
  return { termsKnown, termsTotal: GLOSSARY.length, sectionsDone, resourcesDone, resourcesStarted };
}
