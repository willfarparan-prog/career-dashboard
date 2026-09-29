import type { snapshots } from "@/db/schema";
import type { SnapshotContent } from "@/lib/snapshots/types";
import { exportFileName } from "./common";
import { exportCoverLetter, exportPosting, exportResume } from "./files";
import { CONTENT_TYPES, type ExportFile, type ExportFormat } from "./formats";

/*
 * Renders a frozen snapshot from its stored content — never from live data —
 * so a download always shows what was actually sent.
 */

type SnapshotRow = Pick<typeof snapshots.$inferSelect, "kind" | "content" | "renderedText" | "createdAt">;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The stored content if it has the expected shape for the row's kind, otherwise null. */
export function readSnapshotContent(row: Pick<SnapshotRow, "kind" | "content">): SnapshotContent | null {
  const content = row.content;
  if (!isObject(content) || content.kind !== row.kind || !isObject(content.document)) return null;
  const doc = content.document;
  if (row.kind === "resume" && isObject(doc.person) && Array.isArray(doc.experience)) return content as SnapshotContent;
  if (row.kind === "cover_letter" && isObject(doc.person) && Array.isArray(doc.paragraphs)) return content as SnapshotContent;
  if (row.kind === "posting" && typeof doc.postingText === "string") return content as SnapshotContent;
  return null;
}

/** Postings are text only; everything else defaults to PDF. */
export function snapshotFormats(kind: SnapshotRow["kind"]): { allowed: readonly ExportFormat[]; fallback: ExportFormat } {
  return kind === "posting" ? { allowed: ["txt"], fallback: "txt" } : { allowed: ["pdf", "docx", "txt"], fallback: "pdf" };
}

/**
 * `company` only names a resume file (a resume document doesn't carry it).
 * Returns null when the content can't be rendered in `format`; content in an
 * unknown shape can still be downloaded as its stored text.
 */
export async function exportSnapshot(row: SnapshotRow, format: ExportFormat, company = ""): Promise<ExportFile | null> {
  const content = readSnapshotContent(row);
  if (!content) {
    if (format !== "txt" || !row.renderedText) return null;
    const kind = row.kind === "cover_letter" ? "Cover-Letter" : row.kind === "posting" ? "Posting" : "Resume";
    return { body: Buffer.from(row.renderedText, "utf8"), contentType: CONTENT_TYPES.txt, fileName: exportFileName([company], kind, "txt") };
  }
  if (content.kind === "resume") return exportResume(content.document, format, company);
  if (content.kind === "cover_letter") return exportCoverLetter(content.document, format, { date: new Date(row.createdAt) });
  return format === "txt" ? exportPosting(content.document) : null;
}
