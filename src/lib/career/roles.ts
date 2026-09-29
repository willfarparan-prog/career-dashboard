import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { roles, type FactStatus } from "@/db/schema";
import { sortRoles, type Role } from "@/lib/ai/library";
import { isFactStatus, normalizeMonth } from "./labels";
import { CareerInputError, isUuid, required } from "./util";

export type RoleInput = {
  employer: string;
  title: string;
  start: string;
  end: string;
  isCurrent: boolean;
  location: string;
  employmentType: string;
  summary: string;
  isSaas: boolean;
  factStatus: FactStatus;
};

export function validateRole(input: RoleInput): RoleInput {
  const employer = required(input.employer, "Add the employer.");
  const title = required(input.title, "Add your exact title.");
  const start = normalizeMonth(input.start);
  if (start === null) throw new CareerInputError("Write the start date as YYYY-MM or YYYY, like 2021-03.");
  const end = input.isCurrent ? "" : normalizeMonth(input.end);
  if (end === null) throw new CareerInputError("Write the end date as YYYY-MM or YYYY, like 2023-08.");
  if (start && end && end.localeCompare(start) < 0 && !end.startsWith(start.slice(0, 4))) {
    throw new CareerInputError("The end date is before the start date.");
  }
  if (!isFactStatus(input.factStatus)) throw new CareerInputError("Pick a fact status.");
  return {
    employer,
    title,
    start,
    end,
    isCurrent: input.isCurrent,
    location: input.location.trim(),
    employmentType: input.employmentType.trim(),
    summary: input.summary.trim(),
    isSaas: input.isSaas,
    factStatus: input.factStatus,
  };
}

export async function listRoles(db: Database, userId: string): Promise<Role[]> {
  return sortRoles(await db.select().from(roles).where(eq(roles.userId, userId)));
}

export async function getRole(db: Database, userId: string, id: string): Promise<Role | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(roles).where(and(eq(roles.id, id), eq(roles.userId, userId)));
  return row ?? null;
}

/** An existing role with the same employer and title (case-insensitive), if any. */
export async function findRoleByTitle(db: Database, userId: string, employer: string, title: string): Promise<Role | null> {
  const [row] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.userId, userId), sql`lower(trim(${roles.employer})) = ${employer.trim().toLowerCase()}`, sql`lower(trim(${roles.title})) = ${title.trim().toLowerCase()}`))
    .limit(1);
  return row ?? null;
}

export async function createRole(db: Database, userId: string, input: RoleInput): Promise<Role> {
  const values = validateRole(input);
  const [row] = await db.insert(roles).values({ userId, ...values }).returning();
  return row;
}

export async function updateRole(db: Database, userId: string, id: string, input: RoleInput): Promise<Role> {
  const values = validateRole(input);
  if (!isUuid(id)) throw new CareerInputError("That role no longer exists.");
  const [row] = await db
    .update(roles)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(roles.id, id), eq(roles.userId, userId)))
    .returning();
  if (!row) throw new CareerInputError("That role no longer exists.");
  return row;
}

/** Deletes a role; its achievements stay in the bank without a role. */
export async function deleteRole(db: Database, userId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const deleted = await db.delete(roles).where(and(eq(roles.id, id), eq(roles.userId, userId))).returning({ id: roles.id });
  return deleted.length > 0;
}
