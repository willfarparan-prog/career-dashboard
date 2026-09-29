import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/*
 * The career record is the source of truth. Claude reads it and drafts from
 * it, but never writes a fact here without the owner accepting it first.
 *
 * Every row carries user_id (the Neon Auth user id). The app is single-user
 * today; keying everything by user keeps a later multi-user version a change
 * to auth, not to the data.
 */

export const FACT_STATUSES = ["verified", "approximate", "private", "needs_confirmation"] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

export const EVIDENCE_LABELS = ["strong", "transferable", "gap"] as const;
export type EvidenceLabel = (typeof EVIDENCE_LABELS)[number];

export const REQUIREMENT_KINDS = ["must", "preferred", "responsibility", "tool", "screening"] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

export const APPLICATION_STATUSES = ["saved", "drafting", "ready", "applied", "interview", "offer", "rejected", "withdrawn"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const BULLET_STATES = ["proposed", "accepted", "rejected", "locked"] as const;
export type BulletState = (typeof BULLET_STATES)[number];

export const CAREER_PATHS = ["customer_success", "implementation", "account_management", "employer_wellbeing", "other"] as const;
export type CareerPath = (typeof CAREER_PATHS)[number];

export type Metric = { label: string; value: string; unit: string | null; status: FactStatus };
export type FitWeights = { compensation: number; location: number; fit: number; companySize: number; growth: number; interest: number };
export type EvidencedText = { text: string; evidence: string[] };
export type SkillLine = { name: string; evidence: string[] };

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const profiles = pgTable("profiles", {
  userId: text("user_id").primaryKey(),
  fullName: text("full_name").notNull().default(""),
  headline: text("headline").notNull().default(""),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  location: text("location").notNull().default(""),
  links: jsonb("links").$type<string[]>().notNull().default([]),
  targetRoles: jsonb("target_roles").$type<CareerPath[]>().notNull().default(["customer_success", "implementation", "account_management", "employer_wellbeing"]),
  targetLocations: jsonb("target_locations").$type<string[]>().notNull().default([]),
  remoteOk: boolean("remote_ok").notNull().default(true),
  compMin: integer("comp_min"),
  fitWeights: jsonb("fit_weights").$type<FitWeights>(),
  sendPrivateToClaude: boolean("send_private_to_claude").notNull().default(false),
  keepImportText: boolean("keep_import_text").notNull().default(false),
  updatedAt: updatedAt(),
});

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  employer: text("employer").notNull(),
  title: text("title").notNull(),
  /** "YYYY-MM" or "YYYY". */
  start: text("start").notNull().default(""),
  /** "YYYY-MM" or "YYYY"; empty when current. */
  end: text("end").notNull().default(""),
  isCurrent: boolean("is_current").notNull().default(false),
  location: text("location").notNull().default(""),
  employmentType: text("employment_type").notNull().default(""),
  summary: text("summary").notNull().default(""),
  /** Only a role marked SaaS lets a resume claim formal SaaS experience. */
  isSaas: boolean("is_saas").notNull().default(false),
  factStatus: text("fact_status", { enum: FACT_STATUSES }).notNull().default("needs_confirmation"),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("roles_user_idx").on(t.userId)]);

export const credentials = pgTable("credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  kind: text("kind", { enum: ["education", "certification", "award"] }).notNull(),
  name: text("name").notNull(),
  issuer: text("issuer").notNull().default(""),
  date: text("date").notNull().default(""),
  detail: text("detail").notNull().default(""),
  factStatus: text("fact_status", { enum: FACT_STATUSES }).notNull().default("needs_confirmation"),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [index("credentials_user_idx").on(t.userId)]);

export const skills = pgTable("skills", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  category: text("category", { enum: ["skill", "tool", "domain"] }).notNull().default("skill"),
  factStatus: text("fact_status", { enum: FACT_STATUSES }).notNull().default("needs_confirmation"),
  note: text("note").notNull().default(""),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("skills_user_name_idx").on(t.userId, sql`lower(${t.name})`)]);

export const achievements = pgTable("achievements", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  roleId: uuid("role_id").references(() => roles.id, { onDelete: "set null" }),
  headline: text("headline").notNull(),
  action: text("action").notNull().default(""),
  audience: text("audience").notNull().default(""),
  scale: text("scale").notNull().default(""),
  collaborators: text("collaborators").notNull().default(""),
  tools: jsonb("tools").$type<string[]>().notNull().default([]),
  outcome: text("outcome").notNull().default(""),
  metrics: jsonb("metrics").$type<Metric[]>().notNull().default([]),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  factStatus: text("fact_status", { enum: FACT_STATUSES }).notNull().default("needs_confirmation"),
  evidenceNote: text("evidence_note").notNull().default(""),
  sourceQuote: text("source_quote").notNull().default(""),
  missingMetrics: jsonb("missing_metrics").$type<string[]>().notNull().default([]),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("achievements_user_idx").on(t.userId), index("achievements_role_idx").on(t.roleId)]);

export const careerImports = pgTable("career_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  source: text("source", { enum: ["paste", "pdf", "docx"] }).notNull(),
  fileName: text("file_name").notNull().default(""),
  /** Cleared after review unless the owner chose to keep import text. */
  rawText: text("raw_text"),
  extraction: jsonb("extraction"),
  status: text("status", { enum: ["pending", "reviewed", "discarded", "failed"] }).notNull().default("pending"),
  error: text("error"),
  model: text("model").notNull().default(""),
  promptVersion: text("prompt_version").notNull().default(""),
  createdAt: createdAt(),
}, (t) => [index("career_imports_user_idx").on(t.userId)]);

export type JobAnalysis = {
  summary: string;
  responsibilities: string[];
  tools: string[];
  screeningQuestions: string[];
  seniority: string;
};

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  company: text("company").notNull().default(""),
  title: text("title").notNull().default(""),
  location: text("location").notNull().default(""),
  remoteType: text("remote_type", { enum: ["remote", "hybrid", "onsite", "unknown"] }).notNull().default("unknown"),
  compMin: integer("comp_min"),
  compMax: integer("comp_max"),
  compText: text("comp_text").notNull().default(""),
  deadline: text("deadline").notNull().default(""),
  sourceUrl: text("source_url").notNull().default(""),
  postingText: text("posting_text").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  requisitionId: text("requisition_id").notNull().default(""),
  interest: integer("interest").notNull().default(3),
  companySize: text("company_size", { enum: ["startup", "mid", "enterprise", "unknown"] }).notNull().default("unknown"),
  growth: integer("growth").notNull().default(3),
  careerPath: text("career_path", { enum: CAREER_PATHS }).notNull().default("customer_success"),
  postingStatus: text("posting_status", { enum: ["active", "stale", "closed"] }).notNull().default("active"),
  analysis: jsonb("analysis").$type<JobAnalysis>(),
  analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
  matchedAt: timestamp("matched_at", { withTimezone: true }),
  model: text("model").notNull().default(""),
  promptVersion: text("prompt_version").notNull().default(""),
  notes: text("notes").notNull().default(""),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("jobs_user_idx").on(t.userId)]);

export const jobRequirements = pgTable("job_requirements", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: REQUIREMENT_KINDS }).notNull(),
  text: text("text").notNull(),
  label: text("label", { enum: EVIDENCE_LABELS }),
  labelOverridden: boolean("label_overridden").notNull().default(false),
  achievementIds: jsonb("achievement_ids").$type<string[]>().notNull().default([]),
  rationale: text("rationale").notNull().default(""),
  translation: text("translation").notNull().default(""),
  position: integer("position").notNull().default(0),
}, (t) => [index("job_requirements_job_idx").on(t.jobId)]);

export const resumeDrafts = pgTable("resume_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id"),
  name: text("name").notNull(),
  status: text("status", { enum: ["draft", "approved"] }).notNull().default("draft"),
  summary: text("summary").notNull().default(""),
  summaryEvidence: jsonb("summary_evidence").$type<string[]>().notNull().default([]),
  summaryLocked: boolean("summary_locked").notNull().default(false),
  skills: jsonb("skills").$type<SkillLine[]>().notNull().default([]),
  roleOrder: jsonb("role_order").$type<string[]>().notNull().default([]),
  careerPath: text("career_path", { enum: CAREER_PATHS }).notNull().default("customer_success"),
  model: text("model").notNull().default(""),
  promptVersion: text("prompt_version").notNull().default(""),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("resume_drafts_job_idx").on(t.jobId), index("resume_drafts_user_idx").on(t.userId)]);

export type BulletControls = { tone?: string; length?: string; emphasis?: string };

export const resumeBullets = pgTable("resume_bullets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  draftId: uuid("draft_id").notNull().references(() => resumeDrafts.id, { onDelete: "cascade" }),
  roleId: uuid("role_id").references(() => roles.id, { onDelete: "set null" }),
  /** Null means Claude could not tie this sentence to a real achievement. */
  achievementId: uuid("achievement_id").references(() => achievements.id, { onDelete: "set null" }),
  text: text("text").notNull(),
  originalText: text("original_text").notNull(),
  state: text("state", { enum: BULLET_STATES }).notNull().default("proposed"),
  controls: jsonb("controls").$type<BulletControls>().notNull().default({}),
  position: integer("position").notNull().default(0),
  updatedAt: updatedAt(),
}, (t) => [index("resume_bullets_draft_idx").on(t.draftId)]);

export const qualityFindings = pgTable("quality_findings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  draftId: uuid("draft_id").notNull().references(() => resumeDrafts.id, { onDelete: "cascade" }),
  bulletId: uuid("bullet_id").references(() => resumeBullets.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  severity: text("severity", { enum: ["error", "warning", "info"] }).notNull(),
  message: text("message").notNull(),
  suggestion: text("suggestion").notNull().default(""),
  source: text("source", { enum: ["rule", "claude"] }).notNull(),
  resolved: boolean("resolved").notNull().default(false),
  createdAt: createdAt(),
}, (t) => [index("quality_findings_draft_idx").on(t.draftId)]);

export const coverLetters = pgTable("cover_letters", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  draftId: uuid("draft_id").references(() => resumeDrafts.id, { onDelete: "set null" }),
  paragraphs: jsonb("paragraphs").$type<EvidencedText[]>().notNull().default([]),
  status: text("status", { enum: ["draft", "approved"] }).notNull().default("draft"),
  model: text("model").notNull().default(""),
  promptVersion: text("prompt_version").notNull().default(""),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("cover_letters_job_idx").on(t.jobId)]);

export const applications = pgTable("applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  status: text("status", { enum: APPLICATION_STATUSES }).notNull().default("saved"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  source: text("source").notNull().default(""),
  contactName: text("contact_name").notNull().default(""),
  contactEmail: text("contact_email").notNull().default(""),
  contactNote: text("contact_note").notNull().default(""),
  nextAction: text("next_action").notNull().default(""),
  nextActionDate: text("next_action_date").notNull().default(""),
  notes: text("notes").notNull().default(""),
  resumeSnapshotId: uuid("resume_snapshot_id"),
  coverLetterSnapshotId: uuid("cover_letter_snapshot_id"),
  postingSnapshotId: uuid("posting_snapshot_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("applications_job_idx").on(t.jobId), index("applications_user_idx").on(t.userId)]);

/**
 * What was actually sent. Insert-only: a database trigger rejects every UPDATE,
 * and DELETE works only inside purge_user_data() (the owner's "delete
 * everything"). Deleting a job that has snapshots is refused by the foreign key.
 */
export const snapshots = pgTable("snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  kind: text("kind", { enum: ["resume", "cover_letter", "posting"] }).notNull(),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "restrict" }),
  sourceId: uuid("source_id"),
  content: jsonb("content").notNull(),
  renderedText: text("rendered_text").notNull(),
  contentHash: text("content_hash").notNull(),
  model: text("model").notNull().default(""),
  promptVersion: text("prompt_version").notNull().default(""),
  createdAt: createdAt(),
}, (t) => [index("snapshots_job_idx").on(t.jobId)]);

export const aiRuns = pgTable("ai_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  task: text("task").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  status: text("status", { enum: ["ok", "error", "refused", "blocked", "truncated"] }).notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  error: text("error"),
  refId: text("ref_id"),
  createdAt: createdAt(),
}, (t) => [index("ai_runs_user_created_idx").on(t.userId, t.createdAt)]);
