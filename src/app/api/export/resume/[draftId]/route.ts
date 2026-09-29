import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDatabase } from "@/db";
import { jobs, resumeDrafts } from "@/db/schema";
import { getViewer } from "@/lib/auth/owner";
import { exportResume } from "@/lib/export/files";
import { fileResponse, isUuid, jsonError, noDatabase, notFound, parseFormat, unauthorized, wantsInline } from "@/lib/export/http";
import { loadResumeDocument } from "@/lib/resume/document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/export/resume/:draftId?format=pdf|docx|txt[&inline=1] — the live draft as it stands now. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ draftId: string }> }) {
  const viewer = await getViewer();
  if (!viewer) return unauthorized();
  const db = getDatabase();
  if (!db) return noDatabase();

  const { draftId } = await params;
  if (!isUuid(draftId)) return notFound();
  const format = parseFormat(request.nextUrl.searchParams.get("format"));
  if (!format) return jsonError(400, "Use format=pdf, docx or txt.");

  const doc = await loadResumeDocument(db, viewer.userId, draftId);
  if (!doc) return notFound();

  const [job] = await db
    .select({ company: jobs.company })
    .from(resumeDrafts)
    .innerJoin(jobs, and(eq(jobs.id, resumeDrafts.jobId), eq(jobs.userId, viewer.userId)))
    .where(and(eq(resumeDrafts.id, draftId), eq(resumeDrafts.userId, viewer.userId)));

  const file = await exportResume(doc, format, job?.company ?? "");
  return fileResponse(file, { inline: wantsInline(request.nextUrl.searchParams) });
}
