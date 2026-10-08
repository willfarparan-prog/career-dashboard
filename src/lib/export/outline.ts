import type { ResumeCredential, ResumeDocument } from "@/lib/resume/document";
import { contactLine } from "./common";

/*
 * The resume's reading order, shared by the DOCX and PDF renderers so both
 * put the same text in the same place as the TXT export: header, then
 * conventional sections (empty ones skipped), one column, top to bottom.
 */

export type OutlineBlock =
  | { kind: "text"; text: string }
  | { kind: "role"; heading: { title: string; employer: string }; meta: string; bullets: string[] }
  | { kind: "credential"; name: string; rest: string };

export type OutlineSection = { heading: string; blocks: OutlineBlock[] };

export type ResumeOutline = {
  name: string;
  headline: string;
  contact: string;
  sections: OutlineSection[];
};

function credential(c: ResumeCredential): OutlineBlock {
  const rest = [c.issuer, c.date].filter(Boolean).join(", ");
  return { kind: "credential", name: c.name, rest: (rest ? `, ${rest}` : "") + (c.detail ? ` — ${c.detail}` : "") };
}

export function resumeOutline(doc: ResumeDocument): ResumeOutline {
  const sections: OutlineSection[] = [
    { heading: "SUMMARY", blocks: doc.summary ? [{ kind: "text", text: doc.summary }] : [] },
    {
      heading: "EXPERIENCE",
      blocks: doc.experience.map((role) => ({
        kind: "role",
        heading: { title: role.title.trim(), employer: role.employer.trim() },
        meta: [role.location, role.dates].filter(Boolean).join(" | "),
        bullets: role.bullets.map((bullet) => bullet.trim()).filter(Boolean),
      })),
    },
    { heading: "SKILLS", blocks: doc.skills.length ? [{ kind: "text", text: doc.skills.join(", ") }] : [] },
    { heading: "EDUCATION", blocks: doc.education.map(credential) },
    { heading: "CERTIFICATIONS", blocks: doc.certifications.map(credential) },
    { heading: "AWARDS", blocks: doc.awards.map(credential) },
  ];
  return {
    name: doc.person.fullName.trim(),
    headline: doc.person.headline.trim(),
    contact: contactLine(doc.person),
    sections: sections.filter((section) => section.blocks.length > 0),
  };
}
