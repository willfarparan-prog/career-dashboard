import { and, count, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db";
import { qualityFindings, resumeBullets } from "@/db/schema";

export type DraftReadiness = { proposedBullets: number; openErrors: number };

/** Per draft: bullets still awaiting review, and error-severity check findings not yet resolved. */
export async function draftReadiness(db: Database, userId: string, draftIds: string[]): Promise<Map<string, DraftReadiness>> {
  const result = new Map<string, DraftReadiness>(draftIds.map((id) => [id, { proposedBullets: 0, openErrors: 0 }]));
  if (!draftIds.length) return result;
  const [proposed, errors] = await Promise.all([
    db
      .select({ draftId: resumeBullets.draftId, n: count() })
      .from(resumeBullets)
      .where(and(eq(resumeBullets.userId, userId), inArray(resumeBullets.draftId, draftIds), eq(resumeBullets.state, "proposed")))
      .groupBy(resumeBullets.draftId),
    db
      .select({ draftId: qualityFindings.draftId, n: count() })
      .from(qualityFindings)
      .where(
        and(
          eq(qualityFindings.userId, userId),
          inArray(qualityFindings.draftId, draftIds),
          eq(qualityFindings.severity, "error"),
          eq(qualityFindings.resolved, false),
        ),
      )
      .groupBy(qualityFindings.draftId),
  ]);
  for (const row of proposed) result.get(row.draftId)!.proposedBullets = Number(row.n);
  for (const row of errors) result.get(row.draftId)!.openErrors = Number(row.n);
  return result;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Short, plain description of what's unfinished in a draft ("" when nothing is). */
export function describeReadiness(readiness: DraftReadiness): string {
  return [
    readiness.proposedBullets ? `${plural(readiness.proposedBullets, "bullet", "bullets")} to review` : "",
    readiness.openErrors ? `${plural(readiness.openErrors, "unresolved error", "unresolved errors")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
