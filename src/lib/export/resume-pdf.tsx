import type { Styles } from "@react-pdf/renderer";
import type { ResumeDocument } from "@/lib/resume/document";
import { toWinAnsi as t } from "./common";
import { resumeOutline, type OutlineBlock } from "./outline";
import { MUTED, PDF_META, base, loadReactPdf, type ReactPdf } from "./pdf-base";

/*
 * PDF resume with the same structure and order as the Word and text exports.
 * Text-based (built-in Helvetica), single column, no tables or images.
 */

const styles = {
  headline: { fontSize: 11, marginBottom: 2 },
  section: { marginTop: 12 },
  heading: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10.5,
    borderBottomWidth: 0.75,
    borderBottomColor: "#999999",
    paddingBottom: 2,
    marginBottom: 5,
  },
  paragraph: { marginBottom: 3 },
  role: { marginTop: 8 },
  firstRole: { marginTop: 0 },
  meta: { color: MUTED, marginBottom: 2 },
  bullet: { flexDirection: "row", marginBottom: 2, paddingLeft: 4 },
  mark: { width: 10 },
  bulletText: { flex: 1 },
} satisfies Styles;

function resumeElement({ Document, Page, Text, View }: ReactPdf, doc: ResumeDocument) {
  const outline = resumeOutline(doc);

  const block = (item: OutlineBlock, index: number) => {
    if (item.kind === "text") {
      return (
        <Text key={index} style={styles.paragraph}>
          {t(item.text)}
        </Text>
      );
    }
    if (item.kind === "credential") {
      return (
        <Text key={index} style={styles.paragraph}>
          <Text style={base.bold}>{t(item.name)}</Text>
          {t(item.rest)}
        </Text>
      );
    }
    const { title, employer } = item.heading;
    return (
      <View key={index} style={index === 0 ? styles.firstRole : styles.role}>
        <View wrap={false}>
          <Text>
            <Text style={base.bold}>{t(title || employer)}</Text>
            {title && employer ? t(` — ${employer}`) : ""}
          </Text>
          {item.meta ? <Text style={styles.meta}>{t(item.meta)}</Text> : null}
        </View>
        {item.bullets.map((bullet, bulletIndex) => (
          <View key={bulletIndex} style={styles.bullet} wrap={false}>
            <Text style={styles.mark}>•</Text>
            <Text style={styles.bulletText}>{t(bullet)}</Text>
          </View>
        ))}
      </View>
    );
  };

  return (
    <Document title={t([outline.name, "Resume"].filter(Boolean).join(" — "))} author={t(outline.name)} {...PDF_META}>
      <Page size="LETTER" style={base.page}>
        {outline.name ? <Text style={base.name}>{t(outline.name)}</Text> : null}
        {outline.headline ? <Text style={styles.headline}>{t(outline.headline)}</Text> : null}
        {outline.contact ? <Text style={base.contact}>{t(outline.contact)}</Text> : null}
        {outline.sections.map((section) => (
          <View key={section.heading} style={styles.section}>
            <Text style={styles.heading} minPresenceAhead={36}>
              {section.heading}
            </Text>
            {section.blocks.map(block)}
          </View>
        ))}
      </Page>
    </Document>
  );
}

export async function renderResumePdf(doc: ResumeDocument): Promise<Buffer> {
  const pdf = await loadReactPdf();
  return pdf.renderToBuffer(resumeElement(pdf, doc));
}
