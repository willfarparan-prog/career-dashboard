import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrationStatements } from "./migrations";
import * as schema from "./schema";

/** Opens (and migrates) a PGlite database. `dir` undefined means in-memory. */
export async function openSandbox(dir?: string) {
  const client = new PGlite(dir);
  const { rows } = await client.query<{ exists: boolean }>("select to_regclass('public.profiles') is not null as exists");
  if (!rows[0]?.exists) {
    for (const statement of migrationStatements()) await client.exec(statement);
  }
  const db = drizzle({ client, schema });
  return { client, db };
}
