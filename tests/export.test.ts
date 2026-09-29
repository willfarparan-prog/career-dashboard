import assert from "node:assert/strict";
import { test } from "node:test";
import mammoth from "mammoth";
import { extractText } from "unpdf";
import { exportFileName, fileNamePart, letterParts, toWinAnsi } from "@/lib/export/common";
import { renderCoverLetterDocx, renderCoverLetterText } from "@/lib/export/cover-letter";
import { renderCoverLetterPdf } from "@/lib/export/cover-letter-pdf";
import { exportCoverLetter, exportPosting, exportResume } from "@/lib/export/files";
import { fileResponse, parseFormat, wantsInline } from "@/lib/export/http";
import { isUuid } from "@/lib/export/formats";
import { renderPostingText } from "@/lib/export/posting";
import { renderResumeDocx } from "@/lib/export/resume-docx";
import { renderResumePdf } from "@/lib/export/resume-pdf";
import { exportSnapshot, readSnapshotContent, snapshotFormats } from "@/lib/export/snapshot";
import { renderResumeText, type ResumeDocument } from "@/lib/resume/document";
import type { CoverLetterDocument, PostingSnapshot } from "@/lib/snapshots/types";

/*
 * Parse-back checks: render each format, read the text back the way an
 * applicant tracking system would, and require every heading, role line and
 * bullet to come out complete and in order.
 */

const resume: ResumeDocument = {
  draftId: "00000000-0000-4000-8000-000000000001",
  draftName: "Acme CSM",
  careerPath: "customer_success",
  person: {
    fullName: "Jordan Rivera",
    headline: "Customer success and onboarding lead",
    email: "jordan@example.com",
    phone: "512-555-0100",
    location: "Austin, TX",
    links: ["linkedin.com/in/jordanrivera"],
  },
  summary: "Coach turned customer success lead who builds onboarding programs people finish, and keeps families, staff and partners aligned on the plan.",
  skills: ["Onboarding", "Stakeholder management", "Program design", "Salesforce (learning)"],
  experience: [
    {
      roleId: "r1",
      title: "Head Coach & Program Director",
      employer: "Diamond Edge Athletics",
      location: "Austin, TX",
      dates: "Apr 2021 – Present",
      bullets: [
        "Built a 12-week onboarding program for 40 new families, cutting first-season drop-off by about 30%.",
        "Ran weekly check-ins with parents, staff and partner schools to keep “program adoption” high across three seasons, and turned the feedback into a shared playbook the whole staff now uses.",
        "Managed a $45K annual budget — equipment, travel and facility rentals.",
      ],
    },
    {
      roleId: "r2",
      title: "Assistant Coach",
      employer: "Rice University",
      location: "Houston, TX",
      dates: "Aug 2017 – Mar 2021",
      bullets: ["Coordinated travel and schedules for 35 athletes.", "Tracked player development goals in a shared spreadsheet the head coach reviewed weekly."],
    },
  ],
  education: [{ name: "B.S. Kinesiology", issuer: "Texas State University", date: "2017", detail: "" }],
  certifications: [{ name: "Certified Customer Success Manager", issuer: "SuccessHACKER", date: "Jun 2024", detail: "Level 1" }],
  awards: [],
};

const resumeLines = [
  "Jordan Rivera",
  "Customer success and onboarding lead",
  "Austin, TX | jordan@example.com | 512-555-0100 | linkedin.com/in/jordanrivera",
  "SUMMARY",
  resume.summary,
  "EXPERIENCE",
  "Head Coach & Program Director — Diamond Edge Athletics",
  "Austin, TX | Apr 2021 – Present",
  ...resume.experience[0].bullets,
  "Assistant Coach — Rice University",
  "Houston, TX | Aug 2017 – Mar 2021",
  ...resume.experience[1].bullets,
  "SKILLS",
  "Onboarding, Stakeholder management, Program design, Salesforce (learning)",
  "EDUCATION",
  "B.S. Kinesiology, Texas State University, 2017",
  "CERTIFICATIONS",
  "Certified Customer Success Manager, SuccessHACKER, Jun 2024 — Level 1",
];

const letter: CoverLetterDocument = {
  person: resume.person,
  company: "Acme Health",
  jobTitle: "Customer Success Manager",
  paragraphs: [
    "I'm applying for the Customer Success Manager role at Acme Health because your onboarding work is the part of coaching I like most.",
    "At Diamond Edge I built a 12-week onboarding program for 40 new families and cut first-season drop-off by about 30%.",
    "I'd like to talk about how that carries over to your customers.",
  ],
};
const letterDate = new Date("2026-09-29T15:00:00Z");

const posting: PostingSnapshot = {
  company: "Acme Health",
  title: "Customer Success Manager",
  location: "Remote (US)",
  compText: "$80,000–$95,000",
  sourceUrl: "https://jobs.example.com/acme/123",
  requisitionId: "R-123",
  capturedAt: "2026-09-20T12:00:00.000Z",
  postingText: "About the role\nYou will own onboarding for new clinics.",
};

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

function assertInOrder(text: string, expected: string[], label: string) {
  const haystack = squash(text);
  let from = 0;
  for (const item of expected) {
    const needle = squash(item);
    const at = haystack.indexOf(needle, from);
    assert.ok(at >= 0, `${label}: "${item}" is missing or out of order.\n--- extracted ---\n${text}`);
    from = at + needle.length;
  }
}

async function pdfText(buffer: Buffer) {
  const { text, totalPages } = await extractText(new Uint8Array(buffer), { mergePages: true });
  return { text, totalPages };
}

test("DOCX resume parses back with every heading, role line and bullet in order", async () => {
  const buffer = await renderResumeDocx(resume);
  assert.equal(buffer.subarray(0, 2).toString(), "PK");
  const { value: text } = await mammoth.extractRawText({ buffer });
  assertInOrder(text, resumeLines, "docx");
  assert.doesNotMatch(text, /AWARDS/, "empty sections are skipped");

  const { value: html } = await mammoth.convertToHtml({ buffer });
  assert.doesNotMatch(html, /<table/, "no tables");
  const bullets = resume.experience.flatMap((role) => role.bullets);
  assert.equal(html.match(/<li>/g)?.length, bullets.length, "every bullet is a real list item");
  for (const heading of ["SUMMARY", "EXPERIENCE", "SKILLS", "EDUCATION", "CERTIFICATIONS"]) {
    assert.match(html, new RegExp(`<h1>${heading}</h1>`), `${heading} is a real heading`);
  }
});

test("PDF resume is text-based Helvetica and parses back complete and in order", async () => {
  const buffer = await renderResumePdf(resume);
  assert.equal(buffer.subarray(0, 5).toString(), "%PDF-");
  assert.match(buffer.toString("latin1"), /\/BaseFont \/Helvetica/);
  const { text, totalPages } = await pdfText(buffer);
  assert.equal(totalPages, 1);
  assertInOrder(text, resumeLines, "pdf");
  assert.doesNotMatch(text, /AWARDS/);
});

test("TXT resume snapshot", () => {
  assert.equal(
    renderResumeText(resume),
    `JORDAN RIVERA
Customer success and onboarding lead
Austin, TX | jordan@example.com | 512-555-0100 | linkedin.com/in/jordanrivera

SUMMARY
${resume.summary}

EXPERIENCE
Head Coach & Program Director — Diamond Edge Athletics
Austin, TX | Apr 2021 – Present
- ${resume.experience[0].bullets[0]}
- ${resume.experience[0].bullets[1]}
- ${resume.experience[0].bullets[2]}

Assistant Coach — Rice University
Houston, TX | Aug 2017 – Mar 2021
- ${resume.experience[1].bullets[0]}
- ${resume.experience[1].bullets[1]}

SKILLS
Onboarding, Stakeholder management, Program design, Salesforce (learning)

EDUCATION
B.S. Kinesiology, Texas State University, 2017

CERTIFICATIONS
Certified Customer Success Manager, SuccessHACKER, Jun 2024 — Level 1
`,
  );
});

test("a sparse resume still renders: no contact line, no bullets, only one section", async () => {
  const sparse: ResumeDocument = {
    ...resume,
    person: { fullName: "Sam Lee", headline: "", email: "", phone: "", location: "", links: [] },
    summary: "",
    skills: [],
    experience: [{ roleId: "r", title: "Coach", employer: "", location: "", dates: "2020", bullets: [] }],
    education: [],
    certifications: [],
  };
  const lines = ["Sam Lee", "EXPERIENCE", "Coach", "2020"];
  assertInOrder((await mammoth.extractRawText({ buffer: await renderResumeDocx(sparse) })).value, lines, "docx");
  assertInOrder((await pdfText(await renderResumePdf(sparse))).text, lines, "pdf");
});

const letterLines = [
  "Jordan Rivera",
  "Austin, TX | jordan@example.com | 512-555-0100 | linkedin.com/in/jordanrivera",
  "September 29, 2026",
  "Dear Hiring Team,",
  ...letter.paragraphs,
  "Sincerely,",
  "Jordan Rivera",
];

test("cover letter TXT: contact block, date, greeting, paragraphs, sign-off", () => {
  assert.equal(
    renderCoverLetterText(letter, { date: letterDate }),
    `Jordan Rivera
Austin, TX | jordan@example.com | 512-555-0100 | linkedin.com/in/jordanrivera

September 29, 2026

Dear Hiring Team,

${letter.paragraphs.join("\n\n")}

Sincerely,
Jordan Rivera
`,
  );
});

test("cover letter DOCX and PDF parse back in order", async () => {
  const docx = await renderCoverLetterDocx(letter, { date: letterDate });
  assertInOrder((await mammoth.extractRawText({ buffer: docx })).value, letterLines, "docx");
  const pdf = await pdfText(await renderCoverLetterPdf(letter, { date: letterDate }));
  assert.equal(pdf.totalPages, 1);
  assertInOrder(pdf.text, letterLines, "pdf");
});

test("a letter that already has a greeting or sign-off isn't given a second one", async () => {
  const written = { ...letter, paragraphs: ["Dear Ms. Patel,", ...letter.paragraphs, "Best regards,\nJordan"] };
  const text = renderCoverLetterText(written, { date: letterDate });
  assert.doesNotMatch(text, /Dear Hiring Team/);
  assert.doesNotMatch(text, /Sincerely/);
  assert.match(text, /Dear Ms\. Patel,/);
  const docxHtml = (await mammoth.convertToHtml({ buffer: await renderCoverLetterDocx(written, { date: letterDate }) })).value;
  assert.match(docxHtml, /Best regards,<br \/>Jordan/, "line breaks inside a paragraph survive in Word");
  // Sentences that merely start with a greeting or thank-you word are body text.
  const sentences = letterParts(["Hello there, this is how I got into customer success.", "Thank you for your time and consideration."], "Jo");
  assert.equal(sentences.greeting, "Dear Hiring Team,");
  assert.deepEqual(sentences.signOff, ["Sincerely,", "Jo"]);
  // A greeting on its own line at the top of the first paragraph counts.
  assert.equal(letterParts(["Hi Sam,\nI'm applying for the role.", "Thanks,\nJo"], "Jo").greeting, null);
  assert.deepEqual(letterParts(["Hi Sam,\nI'm applying for the role.", "Thanks,\nJo"], "Jo").signOff, []);
});

test("posting snapshots export as plain text", () => {
  assert.equal(
    renderPostingText(posting),
    `Customer Success Manager — Acme Health
Location: Remote (US)
Compensation: $80,000–$95,000
Requisition: R-123
Source: https://jobs.example.com/acme/123
Captured: 2026-09-20

About the role
You will own onboarding for new clinics.
`,
  );
  const file = exportPosting(posting);
  assert.equal(file.fileName, "Acme-Health-Customer-Success-Manager-Posting.txt");
  assert.equal(file.contentType, "text/plain; charset=utf-8");
});

test("file names are sanitized: <Full-Name>-<Company>-<Kind>.<ext>", async () => {
  assert.equal(exportFileName(["José Núñez", "Acme, Inc."], "Resume", "docx"), "Jose-Nunez-Acme-Inc-Resume.docx");
  assert.equal(exportFileName(["", "  "], "Resume", "pdf"), "Resume.pdf");
  assert.equal(fileNamePart("O’Brien & Sons / Co."), "OBrien-and-Sons-Co");
  assert.equal((await exportResume(resume, "txt", "Acme Health")).fileName, "Jordan-Rivera-Acme-Health-Resume.txt");
  assert.equal((await exportCoverLetter(letter, "txt", { date: letterDate })).fileName, "Jordan-Rivera-Acme-Health-Cover-Letter.txt");
});

test("PDF text is folded into the characters built-in Helvetica can draw", () => {
  assert.equal(toWinAnsi("Onboarding → adoption ≥ 90% “ok” – fine — Łódź​"), "Onboarding -> adoption >= 90% “ok” – fine — Lódz");
  assert.equal(toWinAnsi("Café • 5×"), "Café • 5×");
});

test("format parsing, UUIDs and download headers", async () => {
  assert.equal(parseFormat(null), "pdf");
  assert.equal(parseFormat(" DOCX "), "docx");
  assert.equal(parseFormat("rtf"), null);
  assert.equal(parseFormat("pdf", ["txt"], "txt"), null);
  assert.equal(parseFormat(null, ["txt"], "txt"), "txt");
  assert.equal(wantsInline(new URLSearchParams("inline=1")), true);
  assert.equal(wantsInline(new URLSearchParams("")), false);
  assert.equal(isUuid("00000000-0000-4000-8000-000000000001"), true);
  assert.equal(isUuid("1; drop table"), false);

  const file = await exportResume(resume, "docx", "Acme Health");
  const download = fileResponse(file);
  assert.equal(download.headers.get("Content-Type"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.match(download.headers.get("Content-Disposition") ?? "", /^attachment; filename="Jordan-Rivera-Acme-Health-Resume\.docx"/);
  assert.equal(download.headers.get("Cache-Control"), "private, no-store");
  assert.equal(Buffer.from(await download.arrayBuffer()).equals(file.body), true);
  assert.match(fileResponse(file, { inline: true }).headers.get("Content-Disposition") ?? "", /^inline;/);
});

test("snapshots render from their stored content; postings are TXT only", async () => {
  const createdAt = new Date("2026-08-01T12:00:00Z");
  const resumeRow = { kind: "resume" as const, content: { kind: "resume", document: resume }, renderedText: "stale", createdAt };
  assert.ok(readSnapshotContent(resumeRow));
  const pdf = await exportSnapshot(resumeRow, "pdf", "Acme Health");
  assert.ok(pdf);
  assert.equal(pdf.fileName, "Jordan-Rivera-Acme-Health-Resume.pdf");
  assertInOrder((await pdfText(pdf.body)).text, resumeLines, "snapshot pdf");

  const letterRow = { kind: "cover_letter" as const, content: { kind: "cover_letter", document: letter }, renderedText: "", createdAt };
  const letterTxt = await exportSnapshot(letterRow, "txt");
  assert.match(letterTxt?.body.toString() ?? "", /August 1, 2026/, "a frozen letter keeps the date it was frozen");

  const postingRow = { kind: "posting" as const, content: { kind: "posting", document: posting }, renderedText: "", createdAt };
  assert.deepEqual(snapshotFormats("posting"), { allowed: ["txt"], fallback: "txt" });
  assert.equal(await exportSnapshot(postingRow, "pdf"), null);
  assert.equal((await exportSnapshot(postingRow, "txt"))?.body.toString(), renderPostingText(posting));

  const odd = { kind: "resume" as const, content: {}, renderedText: "What was sent", createdAt };
  assert.equal(readSnapshotContent(odd), null);
  assert.equal(await exportSnapshot(odd, "pdf"), null);
  assert.equal((await exportSnapshot(odd, "txt"))?.body.toString(), "What was sent");
});
