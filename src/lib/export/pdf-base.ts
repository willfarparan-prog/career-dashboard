import type { Styles } from "@react-pdf/renderer";

/*
 * PDF settings shared by the resume and the cover letter: US Letter, ~0.7in
 * margins, the built-in Helvetica (text stays selectable and searchable).
 *
 * @react-pdf/renderer is ESM-only and is loaded with import() so the renderers
 * work both in Next (where it is a server external package) and under the
 * test runner's CommonJS transform.
 */

export type ReactPdf = typeof import("@react-pdf/renderer");

let loading: Promise<ReactPdf> | null = null;

export function loadReactPdf(): Promise<ReactPdf> {
  loading ??= import("@react-pdf/renderer").then((pdf) => {
    // Never split words with hyphens: a parser would read "custo- mer".
    pdf.Font.registerHyphenationCallback((word) => [word]);
    return pdf;
  });
  return loading;
}

export const PAGE_MARGIN = 50;
export const MUTED = "#444444";

export const base = {
  page: {
    paddingTop: PAGE_MARGIN,
    paddingBottom: PAGE_MARGIN,
    paddingHorizontal: PAGE_MARGIN,
    fontFamily: "Helvetica",
    fontSize: 10,
    lineHeight: 1.35,
    color: "#111111",
  },
  name: { fontFamily: "Helvetica-Bold", fontSize: 20, lineHeight: 1.15, marginBottom: 3 },
  contact: { fontSize: 9.5, color: MUTED },
  bold: { fontFamily: "Helvetica-Bold" },
} satisfies Styles;

export const PDF_META = { creator: "Career Dashboard", producer: "Career Dashboard" };
