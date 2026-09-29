/**
 * Local sandbox database (PGlite) for trying the app without Neon or Claude.
 *
 *   pnpm db:local            create .local-db and apply the migrations
 *   pnpm db:local --reset    delete it and start over
 *
 * Then: CAREER_LOCAL_DB=.local-db CAREER_DEV_PREVIEW=1 AI_FAKE=1 pnpm dev
 * Stop the dev server first — PGlite allows one process at a time.
 */
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { openSandbox } from "../src/db/sandbox";

const dir = path.resolve(process.argv.find((arg) => arg.startsWith("--dir="))?.slice(6) ?? ".local-db");
if (process.argv.includes("--reset") && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
const { client } = await openSandbox(dir);
const { rows } = await client.query<{ count: number }>("select count(*)::int as count from information_schema.tables where table_schema = 'public'");
console.log(`Sandbox ready at ${dir} (${rows[0]?.count ?? 0} tables)`);
await client.close();
