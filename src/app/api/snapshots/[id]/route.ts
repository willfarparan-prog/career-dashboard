import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDatabase } from "@/db";
import { jobs, snapshots } from "@/db/schema";
import { getViewer } from "@/lib/auth/owner";
import { fileResponse, isUuid, jsonError, noDatabase, notFound, parseFormat, unauthorized, wantsInline } from "@/lib/export/http";
import { exportSnapshot, snapshotFormats } from "@/lib/export/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/snapshots/:id?format=pdf|docx|txt[&inline=1] — what was actually
 * sent, rendered from the snapshot's stored content. Postings are TXT only.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer) return unauthorized();
  const db = getDatabase();
  if (!db) return noDatabase();

  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const [row] = await db.select().from(snapshots).where(and(eq(snapshots.id, id), eq(snapshots.userId, viewer.userId)));
  if (!row) return notFound();

  const { allowed, fallback } = snapshotFormats(row.kind);
  const format = parseFormat(request.nextUrl.searchParams.get("format"), allowed, fallback);
  if (!format) return jsonError(400, row.kind === "posting" ? "Postings download as text only (format=txt)." : "Use format=pdf, docx or txt.");

  // The company only names the file; the document itself comes from the snapshot.
  let company = "";
  if (row.kind === "resume" && row.jobId) {
    const [job] = await db.select({ company: jobs.company }).from(jobs).where(and(eq(jobs.id, row.jobId), eq(jobs.userId, viewer.userId)));
    company = job?.company ?? "";
  }

  const file = await exportSnapshot(row, format, company);
  if (!file) return jsonError(422, "This snapshot can only be downloaded as text (format=txt).");
  return fileResponse(file, { inline: wantsInline(request.nextUrl.searchParams) });
}
