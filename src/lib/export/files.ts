import { renderResumeText, type ResumeDocument } from "@/lib/resume/document";
import type { CoverLetterDocument, PostingSnapshot } from "@/lib/snapshots/types";
import { exportFileName } from "./common";
import { renderCoverLetterDocx, renderCoverLetterText, type LetterOptions } from "./cover-letter";
import { renderCoverLetterPdf } from "./cover-letter-pdf";
import { CONTENT_TYPES, type ExportFile, type ExportFormat } from "./formats";
import { renderPostingText } from "./posting";
import { renderResumeDocx } from "./resume-docx";
import { renderResumePdf } from "./resume-pdf";

/* One entry point per document kind: pick the renderer and name the file. */

export { CONTENT_TYPES, EXPORT_FORMATS, type ExportFile, type ExportFormat } from "./formats";

const text = (value: string) => Buffer.from(value, "utf8");

export async function exportResume(doc: ResumeDocument, format: ExportFormat, company: string): Promise<ExportFile> {
  const body = format === "docx" ? await renderResumeDocx(doc) : format === "pdf" ? await renderResumePdf(doc) : text(renderResumeText(doc));
  return { body, contentType: CONTENT_TYPES[format], fileName: exportFileName([doc.person.fullName, company], "Resume", format) };
}

export async function exportCoverLetter(doc: CoverLetterDocument, format: ExportFormat, options: LetterOptions = {}): Promise<ExportFile> {
  const body =
    format === "docx"
      ? await renderCoverLetterDocx(doc, options)
      : format === "pdf"
        ? await renderCoverLetterPdf(doc, options)
        : text(renderCoverLetterText(doc, options));
  return { body, contentType: CONTENT_TYPES[format], fileName: exportFileName([doc.person.fullName, doc.company], "Cover-Letter", format) };
}

/** Postings export as TXT only: `<Company>-<Title>-Posting.txt`. */
export function exportPosting(doc: PostingSnapshot): ExportFile {
  return { body: text(renderPostingText(doc)), contentType: CONTENT_TYPES.txt, fileName: exportFileName([doc.company, doc.title], "Posting", "txt") };
}
