import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export type Database = ReturnType<typeof neonDatabase>;

function neonDatabase(url: string) {
  return drizzle(neon(url), { schema });
}

const holder = globalThis as typeof globalThis & { __careerSandboxDb?: Database; __careerNeonDb?: Database };

/**
 * Tests and `next dev` with CAREER_LOCAL_DB use an in-process PGlite database
 * (opened in src/instrumentation.ts or by the test) instead of Neon.
 */
export function setSandboxDatabase(db: unknown) {
  holder.__careerSandboxDb = db as Database;
}

export function getDatabase(): Database | null {
  if (holder.__careerSandboxDb) return holder.__careerSandboxDb;
  if (process.env.NODE_ENV === "development" && process.env.CAREER_LOCAL_DB) {
    throw new Error("CAREER_LOCAL_DB is set but the sandbox database isn't open. Run `pnpm db:local` first.");
  }
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  holder.__careerNeonDb ??= neonDatabase(url);
  return holder.__careerNeonDb;
}

/** Like getDatabase, but for code paths that cannot work without one. */
export function requireDatabase(): Database {
  const db = getDatabase();
  if (!db) throw new Error("DATABASE_URL is not set.");
  return db;
}

/** Rows from db.execute(), which both the Neon and PGlite drivers return under `.rows`. */
export function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}
