import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { skills, type FactStatus } from "@/db/schema";
import type { Skill } from "@/lib/ai/library";
import { isFactStatus, isSkillCategory, type SkillCategory } from "./labels";
import { CareerInputError, isUuid, required } from "./util";

export type SkillInput = {
  name: string;
  category: SkillCategory;
  factStatus: FactStatus;
  note?: string;
};

export function validateSkill(input: SkillInput): Required<SkillInput> {
  if (!isSkillCategory(input.category)) throw new CareerInputError("Pick skill, tool or domain.");
  if (!isFactStatus(input.factStatus)) throw new CareerInputError("Pick a fact status.");
  return {
    name: required(input.name, "Add the skill name.").replace(/\s+/g, " "),
    category: input.category,
    factStatus: input.factStatus,
    note: (input.note ?? "").trim(),
  };
}

export async function listSkills(db: Database, userId: string): Promise<Skill[]> {
  return db.select().from(skills).where(eq(skills.userId, userId)).orderBy(asc(sql`lower(${skills.name})`));
}

export async function findSkillByName(db: Database, userId: string, name: string): Promise<Skill | null> {
  const [row] = await db
    .select()
    .from(skills)
    .where(and(eq(skills.userId, userId), sql`lower(${skills.name}) = ${name.trim().toLowerCase()}`))
    .limit(1);
  return row ?? null;
}

/**
 * Adds a skill unless one with the same name (ignoring case) exists already.
 * The unique index on (user_id, lower(name)) backs this up under a race.
 */
export async function addSkill(db: Database, userId: string, input: SkillInput): Promise<{ skill: Skill; created: boolean }> {
  const values = validateSkill(input);
  const existing = await findSkillByName(db, userId, values.name);
  if (existing) return { skill: existing, created: false };
  const [row] = await db.insert(skills).values({ userId, ...values }).onConflictDoNothing().returning();
  if (row) return { skill: row, created: true };
  const raced = await findSkillByName(db, userId, values.name);
  if (!raced) throw new Error("Couldn't add the skill.");
  return { skill: raced, created: false };
}

export async function updateSkill(db: Database, userId: string, id: string, input: SkillInput): Promise<Skill> {
  const values = validateSkill(input);
  if (!isUuid(id)) throw new CareerInputError("That skill no longer exists.");
  const [clash] = await db
    .select({ id: skills.id })
    .from(skills)
    .where(and(eq(skills.userId, userId), ne(skills.id, id), sql`lower(${skills.name}) = ${values.name.toLowerCase()}`))
    .limit(1);
  if (clash) throw new CareerInputError(`You already have “${values.name}”.`);
  const [row] = await db
    .update(skills)
    .set(values)
    .where(and(eq(skills.id, id), eq(skills.userId, userId)))
    .returning();
  if (!row) throw new CareerInputError("That skill no longer exists.");
  return row;
}

export async function deleteSkill(db: Database, userId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const deleted = await db.delete(skills).where(and(eq(skills.id, id), eq(skills.userId, userId))).returning({ id: skills.id });
  return deleted.length > 0;
}
