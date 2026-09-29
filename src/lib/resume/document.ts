import { and, asc, eq } from "drizzle-orm";
import type { Database } from "@/db";
import { resumeBullets, resumeDrafts, type CareerPath } from "@/db/schema";
import { loadLibrary, type Library } from "@/lib/ai/library";

/*
 * The format-neutral resume that every export (DOCX, PDF, TXT) and every
 * snapshot is rendered from. One single-column structure with conventional
 * headings keeps parsing predictable.
 */

export type ResumeRole = {
  roleId: string;
  title: string;
  employer: string;
  location: string;
  dates: string;
  bullets: string[];
};

export type ResumeCredential = { name: string; issuer: string; date: string; detail: string };

export type ResumeDocument = {
  draftId: string;
  draftName: string;
  careerPath: CareerPath;
  person: { fullName: string; headline: string; email: string; phone: string; location: string; links: string[] };
  summary: string;
  skills: string[];
  experience: ResumeRole[];
  education: ResumeCredential[];
  certifications: ResumeCredential[];
  awards: ResumeCredential[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2023-04" → "Apr 2023"; "2023" → "2023"; anything else passes through. */
export function formatMonth(value: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (match) {
    const month = MONTHS[Number(match[2]) - 1];
    return month ? `${month} ${match[1]}` : match[1];
  }
  return value.trim();
}

/** Consistent "Mon YYYY – Mon YYYY" / "Mon YYYY – Present" ranges. */
export function formatRange(start: string, end: string, isCurrent: boolean): string {
  const from = formatMonth(start);
  const to = isCurrent ? "Present" : formatMonth(end);
  if (from && to) return `${from} – ${to}`;
  return from || to;
}

/** Bullets that make it into a document: everything the owner hasn't rejected. */
export const EXPORTED_STATES = new Set(["proposed", "accepted", "locked"]);

export function buildResumeDocument(
  draft: typeof resumeDrafts.$inferSelect,
  bullets: Array<typeof resumeBullets.$inferSelect>,
  library: Library,
): ResumeDocument {
  const p = library.profile;
  const roleIds = draft.roleOrder.length ? draft.roleOrder : library.roles.map((role) => role.id);
  const roles = roleIds.map((id) => library.roles.find((role) => role.id === id)).filter((role): role is NonNullable<typeof role> => Boolean(role));
  const kept = bullets.filter((bullet) => EXPORTED_STATES.has(bullet.state)).sort((a, b) => a.position - b.position);

  const credential = (kind: "education" | "certification" | "award") =>
    library.credentials
      .filter((c) => c.kind === kind && c.factStatus !== "private")
      .map((c) => ({ name: c.name, issuer: c.issuer, date: formatMonth(c.date), detail: c.detail }));

  return {
    draftId: draft.id,
    draftName: draft.name,
    careerPath: draft.careerPath,
    person: {
      fullName: p?.fullName ?? "",
      headline: p?.headline ?? "",
      email: p?.email ?? "",
      phone: p?.phone ?? "",
      location: p?.location ?? "",
      links: p?.links ?? [],
    },
    summary: draft.summary.trim(),
    skills: draft.skills.map((skill) => skill.name.trim()).filter(Boolean),
    experience: roles.map((role) => ({
      roleId: role.id,
      title: role.title,
      employer: role.employer,
      location: role.location,
      dates: formatRange(role.start, role.end, role.isCurrent),
      bullets: kept.filter((bullet) => bullet.roleId === role.id).map((bullet) => bullet.text.trim()).filter(Boolean),
    })),
    education: credential("education"),
    certifications: credential("certification"),
    awards: credential("award"),
  };
}

export async function loadResumeDocument(db: Database, userId: string, draftId: string): Promise<ResumeDocument | null> {
  const [draft] = await db.select().from(resumeDrafts).where(and(eq(resumeDrafts.id, draftId), eq(resumeDrafts.userId, userId)));
  if (!draft) return null;
  const [bullets, library] = await Promise.all([
    db.select().from(resumeBullets).where(eq(resumeBullets.draftId, draftId)).orderBy(asc(resumeBullets.position)),
    loadLibrary(db, userId),
  ]);
  return buildResumeDocument(draft, bullets, library);
}

const credentialLine = (c: ResumeCredential) => [c.name, c.issuer, c.date].filter(Boolean).join(", ") + (c.detail ? ` — ${c.detail}` : "");

/** Plain-text resume: the TXT export and the text stored with every snapshot. */
export function renderResumeText(doc: ResumeDocument): string {
  const out: string[] = [];
  const contact = [doc.person.location, doc.person.email, doc.person.phone, ...doc.person.links].filter(Boolean).join(" | ");
  if (doc.person.fullName) out.push(doc.person.fullName.toUpperCase());
  if (doc.person.headline) out.push(doc.person.headline);
  if (contact) out.push(contact);
  const section = (title: string, lines: string[]) => {
    if (!lines.length) return;
    out.push("", title.toUpperCase(), ...lines);
  };
  section("Summary", doc.summary ? [doc.summary] : []);
  section(
    "Experience",
    doc.experience.flatMap((role, index) => [
      ...(index > 0 ? [""] : []),
      `${role.title} — ${role.employer}`,
      [role.location, role.dates].filter(Boolean).join(" | "),
      ...role.bullets.map((bullet) => `- ${bullet}`),
    ]).filter((line, index, lines) => line !== "" || lines[index - 1] !== ""),
  );
  section("Skills", doc.skills.length ? [doc.skills.join(", ")] : []);
  section("Education", doc.education.map(credentialLine));
  section("Certifications", doc.certifications.map(credentialLine));
  section("Awards", doc.awards.map(credentialLine));
  return `${out.join("\n").trim()}\n`;
}
