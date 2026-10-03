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
  } else if (dir) {
    // Upgrade an existing local sandbox from the handoff's 0004 schema in place.
    const migration = await client.query<{ exists: boolean }>("select to_regclass('public.career_explorations') is not null as exists");
    if (!migration.rows[0]?.exists) {
      for (const statement of migrationStatements(undefined, "0005_discover_explore.sql")) await client.exec(statement);
    }
  }
  const db = drizzle({ client, schema });
  return { client, db };
}
