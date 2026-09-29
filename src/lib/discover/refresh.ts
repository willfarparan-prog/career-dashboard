import type { Database } from "@/db";
import type { FetchLike, RefreshSummary } from "./types";

/**
 * Runs the owner's active saved searches (or just `searchId`) against their
 * configured sources, respecting each source's interval and quota, and
 * upserts leads. `force` skips the interval (not the quota).
 *
 * PLACEHOLDER — the sources work replaces this with the real implementation.
 */
export async function refreshSearches(
  db: Database,
  userId: string,
  options: { searchId?: string; force?: boolean; now?: Date; fetchImpl?: FetchLike } = {},
): Promise<RefreshSummary> {
  void db;
  void userId;
  void options;
  return { runs: [], added: 0, found: 0 };
}
