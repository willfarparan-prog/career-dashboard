import { createHash } from "node:crypto";
import type { Database } from "@/db";
import { snapshots } from "@/db/schema";
import type { SnapshotContent } from "./types";

/*
 * Freezing what was sent. Snapshots are insert-only (a database trigger
 * refuses UPDATE and DELETE), so this module only ever inserts.
 */

export type Snapshot = typeof snapshots.$inferSelect;
export type SnapshotKind = Snapshot["kind"];

export type NewSnapshot = {
  userId: string;
  kind: SnapshotKind;
  jobId: string | null;
  sourceId: string | null;
  content: SnapshotContent;
  renderedText: string;
  model?: string;
  promptVersion?: string;
};

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, sortKeys(item)]),
    );
  }
  return value;
}

/** JSON with keys sorted at every level, so the hash can be recomputed from the stored jsonb (which reorders keys). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/** sha256 over the rendered text and the structured content. */
export function snapshotHash(renderedText: string, content: unknown): string {
  return createHash("sha256").update(renderedText).update("\u0000").update(canonicalJson(content)).digest("hex");
}

export async function createSnapshot(db: Database, input: NewSnapshot): Promise<Snapshot> {
  if (input.kind !== input.content.kind) throw new Error(`Snapshot kind ${input.kind} doesn't match its content (${input.content.kind}).`);
  const [row] = await db
    .insert(snapshots)
    .values({
      userId: input.userId,
      kind: input.kind,
      jobId: input.jobId,
      sourceId: input.sourceId,
      content: input.content,
      renderedText: input.renderedText,
      contentHash: snapshotHash(input.renderedText, input.content),
      model: input.model ?? "",
      promptVersion: input.promptVersion ?? "",
    })
    .returning();
  return row;
}
