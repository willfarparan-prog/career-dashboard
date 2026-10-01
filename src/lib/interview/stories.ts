import { and, asc, desc, eq } from "drizzle-orm";
import type { Database } from "@/db";
import { achievements, FACT_STATUSES, stories, STORY_FORMATS, type FactStatus, type StoryFormat } from "@/db/schema";
import { COMPETENCIES, competency } from "@/content/interview/competencies";
import type { GuidePath } from "@/content/learn/types";

/*
 * The story bank: the handful of stories you'll retell in every interview,
 * each tagged with the competencies it answers. Stories are part of your
 * record, so they carry a fact status like achievements do.
 */

export type Story = typeof stories.$inferSelect;

/** A problem the owner can fix; its message is safe to show. */
export class InterviewInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InterviewInputError";
  }
}

export type StoryInput = {
  title: string;
  achievementId: string | null;
  format: StoryFormat;
  situation: string;
  task: string;
  action: string;
  result: string;
  body: string;
  competencies: string[];
  factStatus: FactStatus;
};

export function validateStory(input: StoryInput): StoryInput {
  const title = input.title.trim();
  if (!title) throw new InterviewInputError("Give the story a short title, like \"Rebuilt onboarding for new members\".");
  if (!(STORY_FORMATS as readonly string[]).includes(input.format)) throw new InterviewInputError("Pick STAR or free-form.");
  if (!(FACT_STATUSES as readonly string[]).includes(input.factStatus)) throw new InterviewInputError("Pick a fact status.");
  const clean = {
    title,
    achievementId: input.achievementId || null,
    format: input.format,
    situation: input.situation.trim(),
    task: input.task.trim(),
    action: input.action.trim(),
    result: input.result.trim(),
    body: input.body.trim(),
    competencies: [...new Set(input.competencies.filter((key) => competency(key)))],
    factStatus: input.factStatus,
  };
  if (clean.format === "star" && !clean.action) throw new InterviewInputError("Add what you did (the Action). It's the heart of a STAR story.");
  if (clean.format === "free" && !clean.body) throw new InterviewInputError("Write the answer.");
  return clean;
}

async function checkAchievement(db: Database, userId: string, achievementId: string | null) {
  if (!achievementId) return;
  const [row] = await db.select({ id: achievements.id }).from(achievements).where(and(eq(achievements.id, achievementId), eq(achievements.userId, userId)));
  if (!row) throw new InterviewInputError("That achievement wasn't found.");
}

export async function listStories(db: Database, userId: string): Promise<Story[]> {
  return db.select().from(stories).where(eq(stories.userId, userId)).orderBy(asc(stories.sort), desc(stories.updatedAt));
}

export async function getStory(db: Database, userId: string, id: string): Promise<Story | null> {
  const [row] = await db.select().from(stories).where(and(eq(stories.id, id), eq(stories.userId, userId)));
  return row ?? null;
}

export async function createStory(db: Database, userId: string, input: StoryInput): Promise<Story> {
  const values = validateStory(input);
  await checkAchievement(db, userId, values.achievementId);
  const [row] = await db.insert(stories).values({ userId, ...values }).returning();
  return row;
}

export async function updateStory(db: Database, userId: string, id: string, input: StoryInput): Promise<Story | null> {
  const values = validateStory(input);
  await checkAchievement(db, userId, values.achievementId);
  const [row] = await db
    .update(stories)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(stories.id, id), eq(stories.userId, userId)))
    .returning();
  return row ?? null;
}

export async function deleteStory(db: Database, userId: string, id: string): Promise<boolean> {
  const rows = await db.delete(stories).where(and(eq(stories.id, id), eq(stories.userId, userId))).returning({ id: stories.id });
  return rows.length > 0;
}

export type CoverageRow = { key: string; label: string; narrative: boolean; stories: Array<Pick<Story, "id" | "title">> };

/**
 * Which competencies your stories answer, for the paths you're targeting
 * (all competencies when none are given). Uncovered ones come first.
 */
export function storyCoverage(list: Story[], paths: GuidePath[] = []): CoverageRow[] {
  const relevant = COMPETENCIES.filter((c) => !paths.length || c.paths.some((path) => paths.includes(path)));
  const rows = relevant.map((c) => ({
    key: c.key,
    label: c.label,
    narrative: c.narrative,
    stories: list.filter((story) => story.competencies.includes(c.key)).map(({ id, title }) => ({ id, title })),
  }));
  return rows.sort((a, b) => Number(a.stories.length > 0) - Number(b.stories.length > 0));
}

/** Plain text of a story, as you'd say it. */
export function storyText(story: Pick<Story, "format" | "situation" | "task" | "action" | "result" | "body">): string {
  if (story.format === "free") return story.body;
  return [
    story.situation && `Situation: ${story.situation}`,
    story.task && `Task: ${story.task}`,
    story.action && `Action: ${story.action}`,
    story.result && `Result: ${story.result}`,
  ]
    .filter(Boolean)
    .join("\n");
}
