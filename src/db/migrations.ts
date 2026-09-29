import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** The committed SQL migrations, in order, split into single statements. */
export function migrationStatements(dir = path.join(process.cwd(), "drizzle")): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .flatMap((name) => readFileSync(path.join(dir, name), "utf8").split("--> statement-breakpoint"))
    .map((statement) => statement.trim())
    .filter(Boolean);
}
