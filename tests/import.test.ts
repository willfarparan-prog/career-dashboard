import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Document, Packer, Paragraph } from "docx";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/db";
import { achievements, aiRuns, careerImports, credentials, profiles, roles, skills } from "@/db/schema";
import { fakeExtraction, type Extraction } from "@/lib/ai/tasks/extract";
import {
  acceptImport,
  acceptKey,
  buildImportReview,
  discardImport,
  getImport,
  importResume,
  listImports,
  MAX_UPLOAD_BYTES,
  numbersNotInSource,
  readUpload,
} from "@/lib/career/imports";
import { saveContact } from "@/lib/career/profile";
import { createRole } from "@/lib/career/roles";
import { addSkill } from "@/lib/career/skills";
import { CareerInputError } from "@/lib/career/util";
import { testDatabase } from "./helpers";

let db: Database;
let close: () => Promise<void>;
before(async () => ({ db, close } = await testDatabase()));
after(async () => close());

const ME = "import-owner";
const OTHER = "import-stranger";

const RESUME = `Jordan Rivera
Coach and program lead moving into customer success
Tampa, FL | jordan@example.com | (813) 555-0142 | linkedin.com/in/jordanrivera

EXPERIENCE
Head Coach — Harbor Fitness, Tampa, FL | Mar 2019 – Present
- Built a four-week onboarding program for new members with front desk staff, increasing 90-day retention from 62% to 78%
- Coached 1,250 members across 14 weekly classes
- Ran quarterly member challenges

Wellness Program Coordinator at Bayview Benefits Group
2016 – 2019
• Coordinated wellness challenges for 12 client employers with HR teams, reaching 3,400 employees
• Trained 8 site champions using Excel and Slack

EDUCATION
B.S. Exercise Science — University of South Florida, 2015

Skills: Coaching, Program design, Stakeholder management
Tools: Excel, Slack, Mindbody`;

/** Every checkbox on the review form, as it's checked by default. */
function allKeys(extraction: Extraction): string[] {
  return [
    ...(["fullName", "headline", "email", "phone", "location", "links"] as const).map(acceptKey.person),
    ...extraction.roles.map((r) => acceptKey.role(r.key)),
    ...extraction.achievements.map((_, i) => acceptKey.achievement(i)),
    ...extraction.skills.map((_, i) => acceptKey.skill(i)),
    ...extraction.credentials.map((_, i) => acceptKey.credential(i)),
  ];
}

async function importText(userId: string, text = RESUME) {
  const outcome = await importResume(db, userId, { kind: "text", text });
  assert.ok(outcome.ok, outcome.ok ? "" : outcome.error);
  const row = await getImport(db, userId, outcome.id);
  assert.ok(row);
  return row;
}

test("the fake extractor reads roles, bullets, contact details and skills from text", () => {
  const extraction = fakeExtraction(RESUME);
  assert.equal(extraction.person.fullName, "Jordan Rivera");
  assert.equal(extraction.person.email, "jordan@example.com");
  assert.deepEqual(
    extraction.roles.map((r) => [r.key, r.title, r.employer, r.start, r.end, r.isCurrent]),
    [
      ["r1", "Head Coach", "Harbor Fitness", "2019-03", "", true],
      ["r2", "Wellness Program Coordinator", "Bayview Benefits Group", "2016", "2019", false],
    ],
  );
  assert.equal(extraction.achievements.length, 5);
  assert.deepEqual(extraction.achievements.map((a) => a.roleKey), ["r1", "r1", "r1", "r2", "r2"]);
  assert.equal(extraction.achievements[1].sourceQuote, "Coached 1,250 members across 14 weekly classes");
  assert.deepEqual(extraction.achievements[2].metrics, []);
  assert.ok(extraction.achievements[2].missingMetrics.length > 0);
  assert.ok(extraction.skills.some((s) => s.name === "Mindbody" && s.category === "tool"));
  assert.equal(extraction.credentials[0].kind, "education");
});

test("numbers not in the resume are flagged; formatting differences are not", () => {
  const source = "Grew a 1,250-member community; retention rose to 18.5% over 12 months.";
  assert.deepEqual(numbersNotInSource({ metrics: [{ label: "members", value: "1250", unit: null }], outcome: "", scale: "" }, source), []);
  assert.deepEqual(numbersNotInSource({ metrics: [{ label: "retention", value: "18.5", unit: "%" }], outcome: "over 12 months", scale: "" }, source), []);
  assert.deepEqual(numbersNotInSource({ metrics: [{ label: "retention", value: "19", unit: "%" }], outcome: "retention up 20%", scale: "about 1,300 members" }, source), ["19", "20", "1,300"]);
});

test("a text import is saved as pending with the raw text and a logged Claude run", async () => {
  const row = await importText(ME);
  assert.equal(row.status, "pending");
  assert.equal(row.source, "paste");
  assert.equal(row.rawText, RESUME);
  assert.equal(row.promptVersion, "extract@1");
  assert.match(row.model, /^fake:/);
  const runs = await db.select().from(aiRuns).where(and(eq(aiRuns.userId, ME), eq(aiRuns.task, "extract")));
  assert.equal(runs.length, 1);

  const review = await buildImportReview(db, ME, row);
  assert.equal(review.numberCheck, "on");
  assert.ok(review.numberFlags.every((flags) => flags.length === 0), "the fake copies numbers exactly");

  // If Claude had rounded a number, review flags it.
  const tampered = structuredClone(review.extraction!);
  tampered.achievements[0].outcome = "increasing 90-day retention from 62% to 80%";
  tampered.achievements[0].metrics.push({ label: "retention", value: "80", unit: "%" });
  await db.update(careerImports).set({ extraction: tampered }).where(eq(careerImports.id, row.id));
  const flagged = await buildImportReview(db, ME, (await getImport(db, ME, row.id))!);
  assert.deepEqual(flagged.numberFlags[0], ["80"]);
  assert.deepEqual(flagged.numberFlags.slice(1).flat(), []);

  // Other users can't see or act on it.
  assert.equal(await getImport(db, OTHER, row.id), null);
  assert.equal((await listImports(db, OTHER)).length, 0);
  await assert.rejects(acceptImport(db, OTHER, row.id, allKeys(tampered)), CareerInputError);
  await assert.rejects(discardImport(db, OTHER, row.id), CareerInputError);
  await discardImport(db, ME, row.id);
});

test("accepting creates needs_confirmation rows, reuses matching roles and skills, and fills only empty profile fields", async () => {
  await saveContact(db, ME, { fullName: "Jordan R.", headline: "", email: "", phone: "", location: "", links: [] });
  const existingRole = await createRole(db, ME, {
    employer: "harbor fitness",
    title: "HEAD COACH",
    start: "2019-03",
    end: "",
    isCurrent: true,
    location: "",
    employmentType: "",
    summary: "",
    isSaas: false,
    factStatus: "verified",
  });
  await addSkill(db, ME, { name: "coaching", category: "skill", factStatus: "verified" });

  const row = await importText(ME);
  const review = await buildImportReview(db, ME, row);
  const extraction = review.extraction!;
  assert.equal(review.roleMatches.r1, existingRole.id);
  assert.equal(review.roleMatches.r2, undefined);
  assert.ok(review.existingSkills.has("coaching"));

  // Leave one achievement ("Ran quarterly member challenges") and one skill unchecked.
  const skipAchievement = extraction.achievements.findIndex((a) => a.headline === "Ran quarterly member challenges");
  const skipSkill = extraction.skills.findIndex((s) => s.name === "Stakeholder management");
  const keys = allKeys(extraction).filter((k) => k !== acceptKey.achievement(skipAchievement) && k !== acceptKey.skill(skipSkill));
  const summary = await acceptImport(db, ME, row.id, keys);
  assert.deepEqual(summary, { profileFields: 6 - 1, rolesCreated: 1, rolesReused: 1, achievements: 4, achievementsSkipped: 0, skills: 4, credentials: 1 });

  const profile = (await db.select().from(profiles).where(eq(profiles.userId, ME)))[0];
  assert.equal(profile.fullName, "Jordan R.", "an existing field is never overwritten");
  assert.equal(profile.email, "jordan@example.com");
  assert.deepEqual(profile.links, ["linkedin.com/in/jordanrivera"]);

  const roleRows = await db.select().from(roles).where(eq(roles.userId, ME));
  assert.equal(roleRows.length, 2, "Head Coach was reused, not duplicated");
  const bayview = roleRows.find((r) => r.employer === "Bayview Benefits Group");
  assert.ok(bayview);
  assert.equal(bayview.factStatus, "needs_confirmation");
  assert.equal(bayview.title, "Wellness Program Coordinator");
  assert.equal(roleRows.find((r) => r.id === existingRole.id)?.factStatus, "verified", "the reused role keeps its status");

  const bank = await db.select().from(achievements).where(eq(achievements.userId, ME));
  assert.equal(bank.length, 4);
  assert.ok(bank.every((a) => a.factStatus === "needs_confirmation"));
  assert.ok(bank.every((a) => a.metrics.every((m) => m.status === "needs_confirmation")));
  assert.ok(!bank.some((a) => a.headline === "Ran quarterly member challenges"));
  const coached = bank.find((a) => a.sourceQuote === "Coached 1,250 members across 14 weekly classes");
  assert.equal(coached?.roleId, existingRole.id);
  assert.equal(bank.find((a) => a.headline.startsWith("Trained 8 site champions"))?.roleId, bayview.id);
  assert.match(coached?.evidenceNote ?? "", /resume import/);

  const skillRows = await db.select().from(skills).where(eq(skills.userId, ME));
  assert.deepEqual(skillRows.map((s) => s.name.toLowerCase()).sort(), ["coaching", "excel", "mindbody", "program design", "slack"]);
  assert.equal(skillRows.find((s) => s.name === "coaching")?.factStatus, "verified");
  const creds = await db.select().from(credentials).where(eq(credentials.userId, ME));
  assert.deepEqual(creds.map((c) => [c.kind, c.name, c.factStatus]), [["education", "B.S. Exercise Science", "needs_confirmation"]]);

  const done = await getImport(db, ME, row.id);
  assert.equal(done?.status, "reviewed");
  assert.equal(done?.rawText, null, "raw text is cleared after review by default");
  assert.ok(done?.extraction, "the extraction is kept for the record");
  await assert.rejects(acceptImport(db, ME, row.id, keys), /already been reviewed/);

  const review2 = await buildImportReview(db, ME, done!);
  assert.equal(review2.numberCheck, "cleared");
});

test("re-importing the same resume skips duplicates, and keepImportText keeps the text", async () => {
  await db.update(profiles).set({ keepImportText: true }).where(eq(profiles.userId, ME));
  const row = await importText(ME);
  const extraction = (await buildImportReview(db, ME, row)).extraction!;
  const summary = await acceptImport(db, ME, row.id, allKeys(extraction));
  assert.equal(summary.rolesCreated, 0);
  assert.equal(summary.rolesReused, 2);
  assert.equal(summary.achievements, 1, "only the achievement left out last time is new");
  assert.equal(summary.achievementsSkipped, 4);
  assert.equal(summary.profileFields, 0);
  assert.equal(summary.credentials, 0);
  assert.equal(summary.skills, 1);
  assert.equal((await getImport(db, ME, row.id))?.rawText, RESUME);
});

test("discard adds nothing and clears the stored resume", async () => {
  const before = (await db.select().from(achievements).where(eq(achievements.userId, OTHER))).length;
  const row = await importText(OTHER);
  await discardImport(db, OTHER, row.id);
  const discarded = await getImport(db, OTHER, row.id);
  assert.equal(discarded?.status, "discarded");
  assert.equal(discarded?.rawText, null);
  assert.equal(discarded?.extraction, null);
  assert.equal((await db.select().from(achievements).where(eq(achievements.userId, OTHER))).length, before);
  assert.equal((await db.select().from(roles).where(eq(roles.userId, OTHER))).length, 0);
  await assert.rejects(acceptImport(db, OTHER, row.id, []), /already been reviewed/);
  const [listed] = await listImports(db, OTHER);
  assert.equal(listed.status, "discarded");
  assert.equal(listed.counts, null);
});

test("blank input is rejected without saving an import", async () => {
  const outcome = await importResume(db, "blank-user", { kind: "text", text: "   " });
  assert.equal(outcome.ok, false);
  assert.equal((await listImports(db, "blank-user")).length, 0);
});

test("uploads are checked for type, size and signature", async () => {
  const pdf = await readUpload(new File([Buffer.from("%PDF-1.4\n%fake")], "resume.pdf", { type: "application/pdf" }));
  assert.equal(pdf.kind, "pdf");
  await assert.rejects(readUpload(new File([Buffer.from("hello")], "resume.pdf", { type: "application/pdf" })), /readable PDF/);
  await assert.rejects(readUpload(new File([Buffer.from("hello")], "resume.txt", { type: "text/plain" })), /PDF or Word/);
  await assert.rejects(readUpload(new File([Buffer.from("hello")], "resume.doc", { type: "application/msword" })), /\.doc/);
  await assert.rejects(readUpload(new File([Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x25)], "big.pdf", { type: "application/pdf" })), /5 MB/);
  await assert.rejects(readUpload(new File([], "empty.pdf", { type: "application/pdf" })), /empty/);

  // PDFs have no raw text, so the numbers check is skipped.
  const outcome = await importResume(db, "pdf-user", pdf);
  assert.ok(outcome.ok);
  const row = (await getImport(db, "pdf-user", outcome.id))!;
  assert.equal(row.source, "pdf");
  assert.equal(row.fileName, "resume.pdf");
  assert.equal(row.rawText, null);
  const review = await buildImportReview(db, "pdf-user", row);
  assert.equal(review.numberCheck, "pdf");
  assert.ok(review.extraction!.roles.length > 0);
});

test("a Word upload is read as text, so the numbers check runs", async () => {
  const doc = new Document({ sections: [{ children: RESUME.split("\n").map((line) => new Paragraph(line)) }] });
  const bytes = await Packer.toBuffer(doc);
  const input = await readUpload(new File([new Uint8Array(bytes)], "Resume.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
  assert.equal(input.kind, "docx");
  const outcome = await importResume(db, "docx-user", input);
  assert.ok(outcome.ok);
  const row = (await getImport(db, "docx-user", outcome.id))!;
  assert.equal(row.source, "docx");
  assert.match(row.rawText ?? "", /Coached 1,250 members/);
  const review = await buildImportReview(db, "docx-user", row);
  assert.equal(review.numberCheck, "on");
  assert.deepEqual(review.extraction!.roles.map((r) => r.title), ["Head Coach", "Wellness Program Coordinator"]);
});
