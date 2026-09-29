CREATE TABLE "discover_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"source" text NOT NULL,
	"search_id" uuid,
	"query" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"found" integer DEFAULT 0 NOT NULL,
	"added" integer DEFAULT 0 NOT NULL,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"search_id" uuid,
	"dedupe_key" text NOT NULL,
	"title" text NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"is_remote" boolean DEFAULT false NOT NULL,
	"salary_min" integer,
	"salary_max" integer,
	"salary_text" text DEFAULT '' NOT NULL,
	"publisher" text DEFAULT '' NOT NULL,
	"url" text NOT NULL,
	"apply_options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"posted_at" timestamp with time zone,
	"score" integer DEFAULT 0 NOT NULL,
	"score_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"job_id" uuid,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"query" text NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"remote_only" boolean DEFAULT false NOT NULL,
	"sources" jsonb DEFAULT '["jsearch","adzuna","himalayas","remotive","wwr"]'::jsonb NOT NULL,
	"max_age_days" integer DEFAULT 7 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discover_runs" ADD CONSTRAINT "discover_runs_search_id_job_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."job_searches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_leads" ADD CONSTRAINT "job_leads_search_id_job_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."job_searches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_leads" ADD CONSTRAINT "job_leads_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discover_runs_user_source_idx" ON "discover_runs" USING btree ("user_id","source","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_leads_source_external_idx" ON "job_leads" USING btree ("user_id","source","external_id");--> statement-breakpoint
CREATE INDEX "job_leads_user_status_idx" ON "job_leads" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "job_leads_dedupe_idx" ON "job_leads" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "job_searches_user_idx" ON "job_searches" USING btree ("user_id");--> statement-breakpoint
-- "Delete everything" also covers Discover's tables.
CREATE OR REPLACE FUNCTION purge_user_data(uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('career.purge', 'on', true);
  DELETE FROM job_leads WHERE user_id = uid;
  DELETE FROM discover_runs WHERE user_id = uid;
  DELETE FROM job_searches WHERE user_id = uid;
  DELETE FROM applications WHERE user_id = uid;
  DELETE FROM snapshots WHERE user_id = uid;
  DELETE FROM cover_letters WHERE user_id = uid;
  DELETE FROM quality_findings WHERE user_id = uid;
  DELETE FROM resume_bullets WHERE user_id = uid;
  DELETE FROM resume_drafts WHERE user_id = uid;
  DELETE FROM job_requirements WHERE user_id = uid;
  DELETE FROM jobs WHERE user_id = uid;
  DELETE FROM achievements WHERE user_id = uid;
  DELETE FROM skills WHERE user_id = uid;
  DELETE FROM credentials WHERE user_id = uid;
  DELETE FROM roles WHERE user_id = uid;
  DELETE FROM career_imports WHERE user_id = uid;
  DELETE FROM ai_runs WHERE user_id = uid;
  DELETE FROM profiles WHERE user_id = uid;
  PERFORM set_config('career.purge', 'off', true);
END;
$$;
