import { Paragraph, TextRun } from "docx";
import type { CoverLetterDocument } from "@/lib/snapshots/types";
import { contactLine, letterDate, letterParts } from "./common";
import { MUTED, packDocx } from "./docx-base";

/*
 * Cover letter layout, shared by every format: name and contact block, date,
 * "Dear Hiring Team," (unless the letter already opens with a greeting), the
 * paragraphs, then "Sincerely," and the name (unless already signed off).
 */

export type LetterOptions = { date?: Date };

export type LetterLayout = {
  name: string;
  contact: string;
  date: string;
  greeting: string | null;
  body: string[];
  signOff: string[];
};

export function letterLayout(doc: CoverLetterDocument, options: LetterOptions = {}): LetterLayout {
  const name = doc.person.fullName.trim();
  return { name, contact: contactLine(doc.person), date: letterDate(options.date ?? new Date()), ...letterParts(doc.paragraphs, name) };
}

export function renderCoverLetterText(doc: CoverLetterDocument, options: LetterOptions = {}): string {
  const layout = letterLayout(doc, options);
  const blocks: string[] = [];
  const header = [layout.name, layout.contact].filter(Boolean).join("\n");
  if (header) blocks.push(header);
  blocks.push(layout.date);
  if (layout.greeting) blocks.push(layout.greeting);
  blocks.push(...layout.body);
  if (layout.signOff.length) blocks.push(layout.signOff.join("\n"));
  return `${blocks.join("\n\n")}\n`;
}

/** A paragraph's text as runs, keeping the owner's line breaks (Word ignores a raw "\n"). */
const runs = (text: string) => text.split(/\r?\n/).map((line, index) => new TextRun({ text: line, break: index > 0 ? 1 : undefined }));

export async function renderCoverLetterDocx(doc: CoverLetterDocument, options: LetterOptions = {}): Promise<Buffer> {
  const layout = letterLayout(doc, options);
  const children: Paragraph[] = [];
  if (layout.name) children.push(new Paragraph({ children: [new TextRun({ text: layout.name, bold: true, size: 32 })], spacing: { after: 40 } }));
  if (layout.contact) children.push(new Paragraph({ children: [new TextRun({ text: layout.contact, color: MUTED })] }));
  children.push(new Paragraph({ children: [new TextRun(layout.date)], spacing: { before: 360, after: 240 } }));
  if (layout.greeting) children.push(new Paragraph({ children: [new TextRun(layout.greeting)], spacing: { after: 200 } }));
  for (const text of layout.body) children.push(new Paragraph({ children: runs(text), spacing: { after: 200, line: 276 } }));
  layout.signOff.forEach((line, index) =>
    children.push(new Paragraph({ children: [new TextRun(line)], spacing: { before: index === 0 ? 80 : 0, after: index === 0 ? 360 : 0 } })),
  );
  return packDocx({
    title: [layout.name, "Cover letter", doc.company].filter(Boolean).join(" — "),
    creator: layout.name,
    children,
  });
}
