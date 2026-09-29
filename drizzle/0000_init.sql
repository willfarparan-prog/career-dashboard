CREATE TABLE "achievements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"role_id" uuid,
	"headline" text NOT NULL,
	"action" text DEFAULT '' NOT NULL,
	"audience" text DEFAULT '' NOT NULL,
	"scale" text DEFAULT '' NOT NULL,
	"collaborators" text DEFAULT '' NOT NULL,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outcome" text DEFAULT '' NOT NULL,
	"metrics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fact_status" text DEFAULT 'needs_confirmation' NOT NULL,
	"evidence_note" text DEFAULT '' NOT NULL,
	"source_quote" text DEFAULT '' NOT NULL,
	"missing_metrics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"task" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"status" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"error" text,
	"ref_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"job_id" uuid NOT NULL,
	"status" text DEFAULT 'saved' NOT NULL,
	"submitted_at" timestamp with time zone,
	"source" text DEFAULT '' NOT NULL,
	"contact_name" text DEFAULT '' NOT NULL,
	"contact_email" text DEFAULT '' NOT NULL,
	"contact_note" text DEFAULT '' NOT NULL,
	"next_action" text DEFAULT '' NOT NULL,
	"next_action_date" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"resume_snapshot_id" uuid,
	"cover_letter_snapshot_id" uuid,
	"posting_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "career_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"source" text NOT NULL,
	"file_name" text DEFAULT '' NOT NULL,
	"raw_text" text,
	"extraction" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"model" text DEFAULT '' NOT NULL,
	"prompt_version" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cover_letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"job_id" uuid NOT NULL,
	"draft_id" uuid,
	"paragraphs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"prompt_version" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"issuer" text DEFAULT '' NOT NULL,
	"date" text DEFAULT '' NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"fact_status" text DEFAULT 'needs_confirmation' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"job_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"label" text,
	"label_overridden" boolean DEFAULT false NOT NULL,
	"achievement_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"translation" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"remote_type" text DEFAULT 'unknown' NOT NULL,
	"comp_min" integer,
	"comp_max" integer,
	"comp_text" text DEFAULT '' NOT NULL,
	"deadline" text DEFAULT '' NOT NULL,
	"source_url" text DEFAULT '' NOT NULL,
	"posting_text" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"requisition_id" text DEFAULT '' NOT NULL,
	"interest" integer DEFAULT 3 NOT NULL,
	"company_size" text DEFAULT 'unknown' NOT NULL,
	"growth" integer DEFAULT 3 NOT NULL,
	"career_path" text DEFAULT 'customer_success' NOT NULL,
	"posting_status" text DEFAULT 'active' NOT NULL,
	"analysis" jsonb,
	"analyzed_at" timestamp with time zone,
	"matched_at" timestamp with time zone,
	"model" text DEFAULT '' NOT NULL,
	"prompt_version" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"full_name" text DEFAULT '' NOT NULL,
	"headline" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_roles" jsonb DEFAULT '["customer_success","implementation","account_management","employer_wellbeing"]'::jsonb NOT NULL,
	"target_locations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"remote_ok" boolean DEFAULT true NOT NULL,
	"comp_min" integer,
	"fit_weights" jsonb,
	"send_private_to_claude" boolean DEFAULT false NOT NULL,
	"keep_import_text" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quality_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"draft_id" uuid NOT NULL,
	"bullet_id" uuid,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"message" text NOT NULL,
	"suggestion" text DEFAULT '' NOT NULL,
	"source" text NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resume_bullets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"draft_id" uuid NOT NULL,
	"role_id" uuid,
	"achievement_id" uuid,
	"text" text NOT NULL,
	"original_text" text NOT NULL,
	"state" text DEFAULT 'proposed' NOT NULL,
	"controls" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resume_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"job_id" uuid,
	"parent_id" uuid,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"summary_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary_locked" boolean DEFAULT false NOT NULL,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"role_order" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"career_path" text DEFAULT 'customer_success' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"prompt_version" text DEFAULT '' NOT NULL,
	"checked_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"employer" text NOT NULL,
	"title" text NOT NULL,
	"start" text DEFAULT '' NOT NULL,
	"end" text DEFAULT '' NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"employment_type" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"is_saas" boolean DEFAULT false NOT NULL,
	"fact_status" text DEFAULT 'needs_confirmation' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'skill' NOT NULL,
	"fact_status" text DEFAULT 'needs_confirmation' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"job_id" uuid,
	"source_id" uuid,
	"content" jsonb NOT NULL,
	"rendered_text" text NOT NULL,
	"content_hash" text NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"prompt_version" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cover_letters" ADD CONSTRAINT "cover_letters_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cover_letters" ADD CONSTRAINT "cover_letters_draft_id_resume_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."resume_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_requirements" ADD CONSTRAINT "job_requirements_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_findings" ADD CONSTRAINT "quality_findings_draft_id_resume_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."resume_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_findings" ADD CONSTRAINT "quality_findings_bullet_id_resume_bullets_id_fk" FOREIGN KEY ("bullet_id") REFERENCES "public"."resume_bullets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_bullets" ADD CONSTRAINT "resume_bullets_draft_id_resume_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."resume_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_bullets" ADD CONSTRAINT "resume_bullets_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_bullets" ADD CONSTRAINT "resume_bullets_achievement_id_achievements_id_fk" FOREIGN KEY ("achievement_id") REFERENCES "public"."achievements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_drafts" ADD CONSTRAINT "resume_drafts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "achievements_user_idx" ON "achievements" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "achievements_role_idx" ON "achievements" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "ai_runs_user_created_idx" ON "ai_runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_job_idx" ON "applications" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "applications_user_idx" ON "applications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "career_imports_user_idx" ON "career_imports" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cover_letters_job_idx" ON "cover_letters" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "credentials_user_idx" ON "credentials" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "job_requirements_job_idx" ON "job_requirements" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "jobs_user_idx" ON "jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "quality_findings_draft_idx" ON "quality_findings" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "resume_bullets_draft_idx" ON "resume_bullets" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "resume_drafts_job_idx" ON "resume_drafts" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "resume_drafts_user_idx" ON "resume_drafts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "roles_user_idx" ON "roles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skills_user_name_idx" ON "skills" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "snapshots_job_idx" ON "snapshots" USING btree ("job_id");