import { createHash, timingSafeEqual } from "node:crypto";
import { getDatabase } from "@/db";
import { refreshAllUsers } from "@/lib/discover/refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE = { "Cache-Control": "no-store" };

/** Constant-time compare of the Authorization header against "Bearer <CRON_SECRET>". */
function authorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || !header) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

/**
 * Vercel Cron (vercel.json, once a day): refreshes every user's active saved
 * searches. Answers with counts and per-source statuses only, no posting text.
 */
export async function GET(request: Request) {
  if (!authorized(request.headers.get("authorization"))) {
    return Response.json({ error: "Not authorized." }, { status: 401, headers: NO_STORE });
  }
  const db = getDatabase();
  if (!db) return Response.json({ error: "The database isn't configured." }, { status: 503, headers: NO_STORE });

  try {
    const summary = await refreshAllUsers(db);
    return Response.json(
      {
        ok: true,
        users: summary.users,
        failedUsers: summary.failedUsers,
        found: summary.found,
        added: summary.added,
        runs: summary.runs.map(({ source, status, found, added, requests, message }) => ({ source, status, found, added, requests, message })),
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error("Discover cron failed:", error instanceof Error ? error.message : "unknown error");
    return Response.json({ ok: false, error: "Refresh failed." }, { status: 500, headers: NO_STORE });
  }
}
