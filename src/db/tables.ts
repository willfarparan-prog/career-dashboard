import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/*
 * Production migrations are applied by hand, so the health check compares
 * the tables the code expects with the ones the database has. A table added
 * in schema.ts is checked automatically.
 */

/** Every table the schema declares, by name. */
export function schemaTableNames(): string[] {
  const names: string[] = [];
  for (const value of Object.values(schema)) if (is(value, PgTable)) names.push(getTableName(value));
  return names.sort();
}

/** Declared tables that the database doesn't have yet. */
export function missingTables(present: Iterable<string>): string[] {
  const have = new Set(present);
  return schemaTableNames().filter((name) => !have.has(name));
}
