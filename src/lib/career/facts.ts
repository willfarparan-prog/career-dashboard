import { and, eq } from "drizzle-orm";
import type { Database } from "@/db";
import { achievements, credentials, roles, skills, type FactStatus } from "@/db/schema";
import { isFactStatus } from "./labels";
import { CareerInputError, isUuid } from "./util";

export const FACT_KINDS = ["role", "credential", "skill", "achievement"] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export function isFactKind(value: unknown): value is FactKind {
  return typeof value === "string" && (FACT_KINDS as readonly string[]).includes(value);
}

/** Changes one library item's fact status (the quick "Mark verified" buttons). */
export async function setFactStatus(db: Database, userId: string, kind: FactKind, id: string, status: FactStatus): Promise<void> {
  if (!isFactStatus(status)) throw new CareerInputError("Pick a fact status.");
  if (!isFactKind(kind) || !isUuid(id)) throw new CareerInputError("That item no longer exists.");
  let changed: Array<{ id: string }>;
  switch (kind) {
    case "role":
      changed = await db.update(roles).set({ factStatus: status, updatedAt: new Date() }).where(and(eq(roles.id, id), eq(roles.userId, userId))).returning({ id: roles.id });
      break;
    case "credential":
      changed = await db.update(credentials).set({ factStatus: status }).where(and(eq(credentials.id, id), eq(credentials.userId, userId))).returning({ id: credentials.id });
      break;
    case "skill":
      changed = await db.update(skills).set({ factStatus: status }).where(and(eq(skills.id, id), eq(skills.userId, userId))).returning({ id: skills.id });
      break;
    case "achievement": {
      const [current] = await db.select().from(achievements).where(and(eq(achievements.id, id), eq(achievements.userId, userId)));
      if (!current) throw new CareerInputError("That item no longer exists.");
      // Verifying an achievement verifies the numbers still awaiting confirmation on it.
      const metrics = status === "verified" ? current.metrics.map((m) => (m.status === "needs_confirmation" ? { ...m, status } : m)) : current.metrics;
      changed = await db
        .update(achievements)
        .set({ factStatus: status, metrics, updatedAt: new Date() })
        .where(and(eq(achievements.id, id), eq(achievements.userId, userId)))
        .returning({ id: achievements.id });
      break;
    }
  }
  if (!changed.length) throw new CareerInputError("That item no longer exists.");
}
