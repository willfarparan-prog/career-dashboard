import { HeadingLevel, Paragraph, TextRun } from "docx";
import type { ResumeDocument } from "@/lib/resume/document";
import { BULLET_REFERENCE, MUTED, packDocx } from "./docx-base";
import { resumeOutline, type OutlineBlock } from "./outline";

/*
 * Word resume: name (Title style), headline and one contact line, then
 * conventional Heading 1 sections. Roles are a bold "Title — Employer" line, a
 * "Location | Mon YYYY – Present" line, and real Word bullet list items.
 */

function blockParagraphs(block: OutlineBlock, first: boolean): Paragraph[] {
  if (block.kind === "text") {
    return [new Paragraph({ children: [new TextRun(block.text)], spacing: { after: 40 } })];
  }
  if (block.kind === "credential") {
    return [
      new Paragraph({
        children: [new TextRun({ text: block.name, bold: true }), ...(block.rest ? [new TextRun(block.rest)] : [])],
        spacing: { after: 40 },
      }),
    ];
  }
  const heading = [new TextRun({ text: block.heading.title, bold: true })];
  if (block.heading.title && block.heading.employer) heading.push(new TextRun(` — ${block.heading.employer}`));
  else if (block.heading.employer) heading.push(new TextRun({ text: block.heading.employer, bold: true }));
  return [
    new Paragraph({ children: heading, keepNext: true, keepLines: true, spacing: { before: first ? 0 : 160 } }),
    ...(block.meta
      ? [new Paragraph({ children: [new TextRun({ text: block.meta, color: MUTED })], keepNext: block.bullets.length > 0, spacing: { after: 40 } })]
      : []),
    ...block.bullets.map(
      (bullet) =>
        new Paragraph({
          children: [new TextRun(bullet)],
          numbering: { reference: BULLET_REFERENCE, level: 0 },
          spacing: { after: 30 },
        }),
    ),
  ];
}

export async function renderResumeDocx(doc: ResumeDocument): Promise<Buffer> {
  const outline = resumeOutline(doc);
  const children: Paragraph[] = [];
  if (outline.name) children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(outline.name)] }));
  if (outline.headline) children.push(new Paragraph({ children: [new TextRun({ text: outline.headline, size: 22 })], spacing: { after: 20 } }));
  if (outline.contact) children.push(new Paragraph({ children: [new TextRun({ text: outline.contact, color: MUTED })] }));

  for (const section of outline.sections) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(section.heading)] }));
    section.blocks.forEach((block, index) => children.push(...blockParagraphs(block, index === 0)));
  }

  return packDocx({
    title: [outline.name, "Resume"].filter(Boolean).join(" — "),
    creator: outline.name,
    children,
  });
}
