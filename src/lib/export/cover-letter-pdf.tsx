import type { Styles } from "@react-pdf/renderer";
import type { CoverLetterDocument } from "@/lib/snapshots/types";
import { toWinAnsi as t } from "./common";
import { letterLayout, type LetterOptions } from "./cover-letter";
import { PDF_META, base, loadReactPdf, type ReactPdf } from "./pdf-base";

/* PDF cover letter: same layout as the Word and text versions, built-in Helvetica. */

const styles = {
  page: { ...base.page, fontSize: 10.5, lineHeight: 1.45 },
  name: { ...base.name, fontSize: 16 },
  date: { marginTop: 24, marginBottom: 16 },
  paragraph: { marginBottom: 10 },
  signOff: { marginTop: 4 },
  signature: { marginTop: 22 },
} satisfies Styles;

function letterElement({ Document, Page, Text }: ReactPdf, doc: CoverLetterDocument, options: LetterOptions) {
  const layout = letterLayout(doc, options);
  const [closing, ...signature] = layout.signOff;
  return (
    <Document title={t([layout.name, "Cover letter", doc.company].filter(Boolean).join(" — "))} author={t(layout.name)} {...PDF_META}>
      <Page size="LETTER" style={styles.page}>
        {layout.name ? <Text style={styles.name}>{t(layout.name)}</Text> : null}
        {layout.contact ? <Text style={base.contact}>{t(layout.contact)}</Text> : null}
        <Text style={styles.date}>{t(layout.date)}</Text>
        {layout.greeting ? <Text style={styles.paragraph}>{t(layout.greeting)}</Text> : null}
        {layout.body.map((text, index) => (
          <Text key={index} style={styles.paragraph}>
            {t(text)}
          </Text>
        ))}
        {closing ? (
          <Text style={styles.signOff} wrap={false}>
            {t(closing)}
          </Text>
        ) : null}
        {signature.map((line, index) => (
          <Text key={index} style={index === 0 ? styles.signature : undefined}>
            {t(line)}
          </Text>
        ))}
      </Page>
    </Document>
  );
}

export async function renderCoverLetterPdf(doc: CoverLetterDocument, options: LetterOptions = {}): Promise<Buffer> {
  const pdf = await loadReactPdf();
  return pdf.renderToBuffer(letterElement(pdf, doc, options));
}
