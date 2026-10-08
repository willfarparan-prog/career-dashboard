import { and, eq } from "drizzle-orm";
import type { Database } from "@/db";
import { APPLICATION_STATUSES, applications, type ApplicationStatus } from "@/db/schema";
import { parseDay } from "./dates";
import { isFrozen, isUuid, type Application } from "./queries";

export type ApplicationPatch = Partial<{
  status: ApplicationStatus;
  nextAction: string;
  /** "YYYY-MM-DD" or "" to clear. */
  nextActionDate: string;
  contactName: string;
  contactEmail: string;
  contactNote: string;
  source: string;
  notes: string;
}>;

export type UpdateResult = { ok: true; application: Application } | { ok: false; error: string };

const LIMITS: Record<Exclude<keyof ApplicationPatch, "status" | "nextActionDate">, number> = {
  nextAction: 300,
  contactName: 200,
  contactEmail: 320,
  contactNote: 2000,
  source: 200,
  notes: 10_000,
};

export function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return typeof value === "string" && (APPLICATION_STATUSES as readonly string[]).includes(value);
}

/**
 * Updates the tracker fields of one of the user's applications. "Applied" can
 * only be chosen once the application was marked applied (which saves the
 * exact files sent); every other status is always allowed.
 */
export async function updateApplication(db: Database, userId: string, applicationId: string, patch: ApplicationPatch): Promise<UpdateResult> {
  if (!isUuid(applicationId)) return { ok: false, error: "Application not found." };
  const [current] = await db.select().from(applications).where(and(eq(applications.id, applicationId), eq(applications.userId, userId)));
  if (!current) return { ok: false, error: "Application not found." };

  const set: Partial<typeof applications.$inferInsert> = {};
  if (patch.status !== undefined) {
    if (!isApplicationStatus(patch.status)) return { ok: false, error: "Pick a valid status." };
    if (patch.status === "applied" && current.status !== "applied" && !isFrozen(current)) {
      return { ok: false, error: "Use “Mark as applied” on the job page so the exact files you sent are saved." };
    }
    set.status = patch.status;
  }
  if (patch.nextActionDate !== undefined) {
    const raw = patch.nextActionDate.trim();
    const day = raw ? parseDay(raw) : "";
    if (day === null) return { ok: false, error: "Use a date like 2026-10-15 for the next action." };
    set.nextActionDate = day;
  }
  if (patch.contactEmail !== undefined) {
    const email = patch.contactEmail.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That contact email doesn't look right." };
  }
  for (const key of Object.keys(LIMITS) as Array<keyof typeof LIMITS>) {
    const value = patch[key];
    if (value === undefined) continue;
    const text = value.trim();
    if (text.length > LIMITS[key]) return { ok: false, error: `That's too long (${LIMITS[key].toLocaleString("en-US")} characters max).` };
    set[key] = text;
  }
  if (!Object.keys(set).length) return { ok: true, application: current };

  const [updated] = await db
    .update(applications)
    .set({ ...set, updatedAt: new Date() })
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
    .returning();
  return { ok: true, application: updated };
}
