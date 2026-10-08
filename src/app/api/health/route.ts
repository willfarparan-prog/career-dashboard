import { sql } from "drizzle-orm";
import { getDatabase, rowsOf } from "@/db";
import { missingTables } from "@/db/tables";
import { aiConfigured, fakeMode } from "@/lib/ai/run";
import { configuredModel } from "@/lib/ai/models";

export const dynamic = "force-dynamic";

/** Service status without secrets or personal data. */
export async function GET() {
  const db = getDatabase();
  let database: "connected" | "error" | "not_configured" = "not_configured";
  let migrated = false;
  let missing = 0;
  if (db) {
    try {
      // Every table the code expects must exist (production migrations are applied by hand).
      const result = await db.execute(sql`select table_name from information_schema.tables where table_schema = 'public'`);
      missing = missingTables(rowsOf<{ table_name: string }>(result).map((row) => row.table_name)).length;
      migrated = missing === 0;
      database = "connected";
    } catch {
      database = "error";
    }
  }
  return Response.json({
    status: database === "connected" && migrated ? "ok" : "degraded",
    database,
    migrated,
    ...(database === "connected" && missing ? { missingTables: missing } : {}),
    auth: Boolean(process.env.NEON_AUTH_BASE_URL && process.env.NEON_AUTH_COOKIE_SECRET && process.env.OWNER_EMAIL),
    claude: { configured: aiConfigured(), fake: fakeMode(), model: configuredModel() },
  });
}
