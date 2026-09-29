import { getDatabase } from "@/db";
import { getViewer } from "@/lib/auth/owner";
import { exportUserData } from "@/lib/settings/data";

export const dynamic = "force-dynamic";

/** "Export everything": every row stored for the owner, as a JSON download. */
export async function GET() {
  // No session, not the owner, or auth not configured: all the same answer.
  const viewer = await getViewer().catch(() => null);
  if (!viewer) return Response.json({ error: "Not authorized." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const db = getDatabase();
  if (!db) return Response.json({ error: "The database isn't configured." }, { status: 503, headers: { "Cache-Control": "no-store" } });

  const now = new Date();
  const data = await exportUserData(db, viewer.userId, now);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="career-dashboard-export-${now.toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
