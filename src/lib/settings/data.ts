import { eq, getTableName, is, sql } from "drizzle-orm";
import { PgTable, type PgColumn } from "drizzle-orm/pg-core";
import type { Database } from "@/db";
import * as schema from "@/db/schema";

/*
 * "Export everything" and "Delete everything". The export walks every table
 * the schema declares, so a table added later is included automatically.
 */

type UserTable = { name: string; table: PgTable; userId: PgColumn };

export function userTables(): UserTable[] {
  const tables: UserTable[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const userId = (value as unknown as { userId?: PgColumn }).userId;
    if (!userId) continue;
    tables.push({ name: getTableName(value), table: value, userId });
  }
  return tables.sort((a, b) => a.name.localeCompare(b.name));
}

export type DataExport = {
  exportedAt: string;
  userId: string;
  note: string;
  tables: Record<string, unknown[]>;
};

export async function exportUserData(db: Database, userId: string, now = new Date()): Promise<DataExport> {
  const tables: Record<string, unknown[]> = {};
  for (const { name, table, userId: column } of userTables()) {
    tables[name] = await db.select().from(table).where(eq(column, userId));
  }
  return {
    exportedAt: now.toISOString(),
    userId,
    note: "Every row this workspace stores for you, one array per table. Snapshots hold the exact files sent with each application.",
    tables,
  };
}

/** Deletes every row for the user, snapshots included (the only path allowed to delete them). */
export async function purgeUserData(db: Database, userId: string): Promise<void> {
  await db.execute(sql`select purge_user_data(${userId})`);
}
