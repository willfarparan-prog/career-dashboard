/**
 * Shared test setup: an in-memory PGlite database with every migration applied,
 * wired in as the app's database, and Claude in fake mode (no network, no spend).
 */
import { setSandboxDatabase, type Database } from "@/db";
import { openSandbox } from "@/db/sandbox";

process.env.AI_FAKE = "1";

export const TEST_USER = "test-user";

export async function testDatabase(): Promise<{ db: Database; close: () => Promise<void> }> {
  const { client, db } = await openSandbox();
  setSandboxDatabase(db);
  return { db: db as unknown as Database, close: () => client.close() };
}
