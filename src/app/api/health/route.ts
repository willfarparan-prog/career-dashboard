import { sql } from "drizzle-orm";
import { getDatabase, rowsOf } from "@/db";
import { aiConfigured, fakeMode } from "@/lib/ai/run";
import { configuredModel } from "@/lib/ai/models";

export const dynamic = "force-dynamic";

/** Service status without secrets or personal data. */
export async function GET() {
  const db = getDatabase();
  let database: "connected" | "error" | "not_configured" = "not_configured";
  let migrated = false;
  if (db) {
    try {
      const result = await db.execute(sql`select to_regclass('public.snapshots') is not null as ok`);
      migrated = Boolean(rowsOf<{ ok: boolean }>(result)[0]?.ok);
      database = "connected";
    } catch {
      database = "error";
    }
  }
  return Response.json({
    status: database === "connected" && migrated ? "ok" : "degraded",
    database,
    migrated,
    auth: Boolean(process.env.NEON_AUTH_BASE_URL && process.env.NEON_AUTH_COOKIE_SECRET && process.env.OWNER_EMAIL),
    claude: { configured: aiConfigured(), fake: fakeMode(), model: configuredModel() },
  });
}
