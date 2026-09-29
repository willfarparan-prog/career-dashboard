import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { achievements, careerImports, credentials, profiles, roles } from "@/db/schema";
import type { Profile } from "@/lib/ai/library";
import { aiErrorMessage } from "@/lib/ai/run";
import { ExtractionSchema, extractCareer, type ExtractedAchievement, type Extraction, type ExtractInput } from "@/lib/ai/tasks/extract";
import { normalizeMonth } from "./labels";
import { ensureProfile, getProfile } from "./profile";
import { findRoleByTitle } from "./roles";
import { addSkill, listSkills } from "./skills";
import { CareerInputError, cleanList, cleanTags, isUuid } from "./util";

export type CareerImport = typeof careerImports.$inferSelect;

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const PDF_TYPES = new Set(["application/pdf", "application/x-pdf"]);
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Checks an uploaded resume (type, size, file signature) and turns it into extractor input. */
export async function readUpload(file: File): Promise<ExtractInput> {
  const name = file.name || "resume";
  const lower = name.toLowerCase();
  if (!file.size) throw new CareerInputError("That file is empty.");
  if (file.size > MAX_UPLOAD_BYTES) throw new CareerInputError("That file is over 5 MB. Try a smaller export, or paste the text instead.");
  if (lower.endsWith(".doc") || file.type === "application/msword") {
    throw new CareerInputError("Older .doc files can't be read. Save it as .docx or PDF, or paste the text.");
  }
  const isPdf = lower.endsWith(".pdf") || PDF_TYPES.has(file.type);
  const isDocx = lower.endsWith(".docx") || file.type === DOCX_TYPE;
  if (!isPdf && !isDocx) throw new CareerInputError("Upload a PDF or Word (.docx) file, or paste the text.");

  const buffer = Buffer.from(await file.arrayBuffer());
  if (isPdf) {
    if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") throw new CareerInputError("That file isn't a readable PDF.");
    return { kind: "pdf", base64: buffer.toString("base64"), fileName: name };
  }
  // A .docx is a zip archive.
  if (buffer.subarray(0, 4).toString("latin1") !== "PK\u0003\u0004") throw new CareerInputError("That file isn't a readable Word document.");
  return { kind: "docx", buffer, fileName: name };
}

export type ImportOutcome = { ok: true; id: string } | { ok: false; error: string };

/** Runs Claude on the resume and saves the proposal as a pending import. Failures are logged as failed imports. */
export async function importResume(db: Database, userId: string, input: ExtractInput): Promise<ImportOutcome> {
  const source = input.kind === "text" ? "paste" : input.kind;
  const fileName = input.kind === "text" ? "" : input.fileName;
  let result;
  try {
    result = await extractCareer(db, userId, input);
  } catch (error) {
    if (error instanceof CareerInputError) return { ok: false, error: error.message };
    const message = aiErrorMessage(error);
    // Keep a record of the attempt, but not the resume itself.
    await db.insert(careerImports).values({ userId, source, fileName, status: "failed", error: message.slice(0, 2000) });
    return { ok: false, error: message };
  }
  const [row] = await db
    .insert(careerImports)
    .values({
      userId,
      source: result.source,
      fileName: result.fileName,
      rawText: result.rawText,
      extraction: result.output,
      status: "pending",
      model: result.model,
      promptVersion: result.promptVersion,
    })
    .returning({ id: careerImports.id });
  return { ok: true, id: row.id };
}

export type ImportListItem = Pick<CareerImport, "id" | "source" | "fileName" | "status" | "error" | "createdAt"> & {
  counts: { roles: number; achievements: number; skills: number } | null;
};

export async function listImports(db: Database, userId: string, limit = 20): Promise<ImportListItem[]> {
  const rows = await db
    .select({
      id: careerImports.id,
      source: careerImports.source,
      fileName: careerImports.fileName,
      status: careerImports.status,
      error: careerImports.error,
      createdAt: careerImports.createdAt,
      extraction: careerImports.extraction,
    })
    .from(careerImports)
    .where(eq(careerImports.userId, userId))
    .orderBy(desc(careerImports.createdAt))
    .limit(limit);
  return rows.map(({ extraction, ...row }) => {
    const parsed = parseExtraction(extraction);
    return { ...row, counts: parsed ? { roles: parsed.roles.length, achievements: parsed.achievements.length, skills: parsed.skills.length } : null };
  });
}

export function importSourceLabel(item: Pick<CareerImport, "source" | "fileName">): string {
  if (item.source === "paste") return "Pasted text";
  return item.fileName || (item.source === "pdf" ? "PDF" : "Word file");
}

export async function getImport(db: Database, userId: string, id: string): Promise<CareerImport | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(careerImports).where(and(eq(careerImports.id, id), eq(careerImports.userId, userId)));
  return row ?? null;
}

export function parseExtraction(value: unknown): Extraction | null {
  const parsed = ExtractionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/* ---------------------------- numbers check ----------------------------- */

const NUMBER_TOKEN = /\d[\d,]*(?:\.\d+)?/g;

const normalizeNumber = (token: string) => token.replace(/,/g, "").replace(/^0+(?=\d)/, "");

/** Every number in a text, normalized ("1,250" → "1250"). */
export function numbersIn(text: string): string[] {
  return [...text.matchAll(NUMBER_TOKEN)].map((m) => normalizeNumber(m[0]));
}

/**
 * Numbers in an extracted achievement (metric values, outcome, scale) that
 * don't appear anywhere in the source text — a sign Claude rounded, converted
 * or invented one. Returned as written.
 */
export function numbersNotInSource(achievement: Pick<ExtractedAchievement, "metrics" | "outcome" | "scale">, sourceText: string): string[] {
  const known = new Set(numbersIn(sourceText));
  const texts = [...achievement.metrics.map((m) => m.value), achievement.outcome, achievement.scale];
  const missing = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(NUMBER_TOKEN)) {
      const token = match[0].replace(/,$/, "");
      if (!known.has(normalizeNumber(token))) missing.add(token);
    }
  }
  return [...missing];
}

/* ------------------------------ review ---------------------------------- */

export type NumberCheck = "on" | "pdf" | "cleared";

export type ImportReview = {
  row: CareerImport;
  extraction: Extraction | null;
  profile: Profile | null;
  numberCheck: NumberCheck;
  /** Per achievement (same order as extraction.achievements): numbers not found in the resume. */
  numberFlags: string[][];
  /** Extracted role key → id of an existing role with the same employer and title. */
  roleMatches: Record<string, string>;
  /** Lowercased names of skills already in the library. */
  existingSkills: Set<string>;
};

export async function buildImportReview(db: Database, userId: string, row: CareerImport): Promise<ImportReview> {
  const extraction = parseExtraction(row.extraction);
  const [profile, skillRows] = await Promise.all([getProfile(db, userId), listSkills(db, userId)]);
  const numberCheck: NumberCheck = row.source === "pdf" ? "pdf" : row.rawText ? "on" : "cleared";
  const roleMatches: Record<string, string> = {};
  for (const role of extraction?.roles ?? []) {
    const match = role.employer && role.title ? await findRoleByTitle(db, userId, role.employer, role.title) : null;
    if (match) roleMatches[role.key] = match.id;
  }
  return {
    row,
    extraction,
    profile,
    numberCheck,
    numberFlags: (extraction?.achievements ?? []).map((a) => (numberCheck === "on" && row.rawText ? numbersNotInSource(a, row.rawText) : [])),
    roleMatches,
    existingSkills: new Set(skillRows.map((s) => s.name.toLowerCase())),
  };
}

/* ------------------------------ accept ---------------------------------- */

export const PERSON_FIELDS = ["fullName", "headline", "email", "phone", "location", "links"] as const;
export type PersonField = (typeof PERSON_FIELDS)[number];

/** Checkbox values on the review form. */
export const acceptKey = {
  person: (field: PersonField) => `person:${field}`,
  role: (key: string) => `role:${key}`,
  achievement: (index: number) => `achievement:${index}`,
  skill: (index: number) => `skill:${index}`,
  credential: (index: number) => `credential:${index}`,
};

export type AcceptSummary = {
  profileFields: number;
  rolesCreated: number;
  rolesReused: number;
  achievements: number;
  achievementsSkipped: number;
  skills: number;
  credentials: number;
};

async function pendingImport(db: Database, userId: string, id: string) {
  const row = await getImport(db, userId, id);
  if (!row) throw new CareerInputError("That import no longer exists.");
  if (row.status !== "pending") throw new CareerInputError("This import has already been reviewed.");
  return row;
}

/**
 * Adds the accepted parts of an import to the library. Everything lands as
 * needs_confirmation for the owner to verify; existing roles and skills are
 * reused, and only empty profile fields are filled.
 */
export async function acceptImport(db: Database, userId: string, id: string, acceptedKeys: Iterable<string>): Promise<AcceptSummary> {
  const row = await pendingImport(db, userId, id);
  const extraction = parseExtraction(row.extraction);
  if (!extraction) throw new CareerInputError("This import can't be read. Discard it and try again.");
  const accepted = new Set(acceptedKeys);
  const summary: AcceptSummary = { profileFields: 0, rolesCreated: 0, rolesReused: 0, achievements: 0, achievementsSkipped: 0, skills: 0, credentials: 0 };

  // Profile: fill empty fields only.
  const profile = await ensureProfile(db, userId);
  const person = extraction.person;
  const updates: Partial<Pick<Profile, "fullName" | "headline" | "email" | "phone" | "location" | "links">> = {};
  for (const field of ["fullName", "headline", "email", "phone", "location"] as const) {
    if (accepted.has(acceptKey.person(field)) && person[field].trim() && !profile[field].trim()) updates[field] = person[field].trim();
  }
  const links = cleanList(person.links);
  if (accepted.has(acceptKey.person("links")) && links.length && profile.links.length === 0) updates.links = links;
  summary.profileFields = Object.keys(updates).length;
  if (summary.profileFields) await db.update(profiles).set({ ...updates, updatedAt: new Date() }).where(eq(profiles.userId, userId));

  // Roles: reuse a matching role; otherwise create the accepted ones.
  const roleIds = new Map<string, string>();
  for (const [index, role] of extraction.roles.entries()) {
    const employer = role.employer.trim();
    const title = role.title.trim();
    if (!employer && !title) continue;
    const existing = await findRoleByTitle(db, userId, employer, title);
    if (existing) {
      roleIds.set(role.key, existing.id);
      if (accepted.has(acceptKey.role(role.key))) summary.rolesReused++;
      continue;
    }
    if (!accepted.has(acceptKey.role(role.key))) continue;
    const [created] = await db
      .insert(roles)
      .values({
        userId,
        employer,
        title,
        start: normalizeMonth(role.start) ?? "",
        end: role.isCurrent ? "" : (normalizeMonth(role.end) ?? ""),
        isCurrent: role.isCurrent,
        location: role.location.trim(),
        employmentType: role.employmentType.trim(),
        summary: role.summary.trim(),
        factStatus: "needs_confirmation",
        sort: index,
      })
      .returning({ id: roles.id });
    roleIds.set(role.key, created.id);
    summary.rolesCreated++;
  }

  // Achievements: skip ones already in the bank under the same role.
  const evidenceNote = `From resume import (${row.fileName || "pasted text"})`;
  for (const [index, a] of extraction.achievements.entries()) {
    if (!accepted.has(acceptKey.achievement(index))) continue;
    const headline = (a.headline.trim() || a.action.trim()).slice(0, 200);
    if (!headline) continue;
    const roleId = a.roleKey ? (roleIds.get(a.roleKey) ?? null) : null;
    const [duplicate] = await db
      .select({ id: achievements.id })
      .from(achievements)
      .where(and(eq(achievements.userId, userId), roleId ? eq(achievements.roleId, roleId) : isNull(achievements.roleId), sql`lower(trim(${achievements.headline})) = ${headline.toLowerCase()}`))
      .limit(1);
    if (duplicate) {
      summary.achievementsSkipped++;
      continue;
    }
    await db.insert(achievements).values({
      userId,
      roleId,
      headline,
      action: a.action.trim(),
      audience: a.audience.trim(),
      scale: a.scale.trim(),
      collaborators: a.collaborators.trim(),
      tools: cleanList(a.tools),
      outcome: a.outcome.trim(),
      metrics: a.metrics
        .filter((m) => m.value.trim())
        .map((m) => ({ label: m.label.trim() || "number", value: m.value.trim(), unit: m.unit?.trim() || null, status: "needs_confirmation" as const })),
      tags: cleanTags(a.tags),
      factStatus: "needs_confirmation",
      evidenceNote,
      sourceQuote: a.sourceQuote.trim(),
      missingMetrics: cleanList(a.missingMetrics),
      sort: index,
    });
    summary.achievements++;
  }

  for (const [index, skill] of extraction.skills.entries()) {
    if (!accepted.has(acceptKey.skill(index)) || !skill.name.trim()) continue;
    const { created } = await addSkill(db, userId, { name: skill.name, category: skill.category, factStatus: "needs_confirmation" });
    if (created) summary.skills++;
  }

  for (const [index, credential] of extraction.credentials.entries()) {
    if (!accepted.has(acceptKey.credential(index))) continue;
    const name = credential.name.trim();
    if (!name) continue;
    const [duplicate] = await db
      .select({ id: credentials.id })
      .from(credentials)
      .where(and(eq(credentials.userId, userId), eq(credentials.kind, credential.kind), sql`lower(trim(${credentials.name})) = ${name.toLowerCase()}`))
      .limit(1);
    if (duplicate) continue;
    await db.insert(credentials).values({
      userId,
      kind: credential.kind,
      name,
      issuer: credential.issuer.trim(),
      date: credential.date.trim(),
      detail: credential.detail.trim(),
      factStatus: "needs_confirmation",
      sort: index,
    });
    summary.credentials++;
  }

  await db
    .update(careerImports)
    .set({ status: "reviewed", rawText: profile.keepImportText ? row.rawText : null })
    .where(and(eq(careerImports.id, row.id), eq(careerImports.userId, userId)));
  return summary;
}

/** Throws the proposal away: nothing is added, and the resume text and extraction are cleared. */
export async function discardImport(db: Database, userId: string, id: string): Promise<void> {
  const row = await getImport(db, userId, id);
  if (!row) throw new CareerInputError("That import no longer exists.");
  if (row.status === "reviewed") throw new CareerInputError("This import was already added to your library.");
  await db
    .update(careerImports)
    .set({ status: "discarded", rawText: null, extraction: null })
    .where(and(eq(careerImports.id, row.id), eq(careerImports.userId, userId)));
}
