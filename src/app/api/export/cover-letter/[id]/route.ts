import type { NextRequest } from "next/server";
import { getDatabase } from "@/db";
import { getViewer } from "@/lib/auth/owner";
import { loadCoverLetterDocument } from "@/lib/cover/document";
import { exportCoverLetter } from "@/lib/export/files";
import { fileResponse, isUuid, jsonError, noDatabase, notFound, parseFormat, unauthorized, wantsInline } from "@/lib/export/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/export/cover-letter/:id?format=pdf|docx|txt[&inline=1] — a saved letter, dated today. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer) return unauthorized();
  const db = getDatabase();
  if (!db) return noDatabase();

  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const format = parseFormat(request.nextUrl.searchParams.get("format"));
  if (!format) return jsonError(400, "Use format=pdf, docx or txt.");

  const loaded = await loadCoverLetterDocument(db, viewer.userId, id);
  if (!loaded) return notFound();

  const file = await exportCoverLetter(loaded.document, format, { date: new Date() });
  return fileResponse(file, { inline: wantsInline(request.nextUrl.searchParams) });
}
