import { AlignmentType, BorderStyle, Document, LevelFormat, Packer, type Paragraph } from "docx";

/*
 * Word settings shared by the resume and the cover letter: US Letter,
 * ~0.7in margins, Calibri 10.5pt, one plain section — no tables, text boxes,
 * columns, or content in headers and footers, so parsers read it in order.
 */

/** Half-points (docx unit for font size). */
export const BODY_SIZE = 21;
/** 0.7in in twips. */
const MARGIN = 1008;
export const BULLET_REFERENCE = "resume-bullet";
export const MUTED = "444444";

export async function packDocx(options: { title: string; creator: string; children: Paragraph[] }): Promise<Buffer> {
  const document = new Document({
    title: options.title,
    creator: options.creator || "Career Dashboard",
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: BODY_SIZE },
          paragraph: { spacing: { before: 0, after: 0, line: 259 } },
        },
        title: {
          run: { font: "Calibri", size: 40, bold: true, color: "000000" },
          paragraph: { spacing: { after: 40 } },
        },
        heading1: {
          run: { font: "Calibri", size: 22, bold: true, color: "000000" },
          paragraph: {
            spacing: { before: 220, after: 80 },
            keepNext: true,
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } },
          },
        },
        listParagraph: {
          run: { font: "Calibri", size: BODY_SIZE },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: BULLET_REFERENCE,
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 360, hanging: 220 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN, header: 0, footer: 0 },
          },
        },
        children: options.children,
      },
    ],
  });
  return Packer.toBuffer(document);
}
