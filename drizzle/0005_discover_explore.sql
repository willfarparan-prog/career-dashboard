CREATE TABLE "career_explorations" (
	"user_id" text PRIMARY KEY NOT NULL,
	"preferences" jsonb NOT NULL,
	"directions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_fingerprint" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_fit_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"lead_id" uuid NOT NULL,
	"content" jsonb NOT NULL,
	"input_fingerprint" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_search_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"lead_id" uuid NOT NULL,
	"search_id" uuid,
	"search_key" text NOT NULL,
	"mode" text DEFAULT 'priority' NOT NULL,
	"query" text NOT NULL,
	"direction_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"score" integer NOT NULL,
	"score_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_leads" ADD COLUMN "salary_provenance" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_searches" ADD COLUMN "mode" text DEFAULT 'priority' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_searches" ADD COLUMN "direction_terms" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_fit_reviews" ADD CONSTRAINT "lead_fit_reviews_lead_id_job_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."job_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_search_matches" ADD CONSTRAINT "lead_search_matches_lead_id_job_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."job_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_search_matches" ADD CONSTRAINT "lead_search_matches_search_id_job_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."job_searches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_fit_reviews_user_lead_idx" ON "lead_fit_reviews" USING btree ("user_id","lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_search_matches_key_idx" ON "lead_search_matches" USING btree ("user_id","lead_id","search_key");--> statement-breakpoint
CREATE INDEX "lead_search_matches_mode_idx" ON "lead_search_matches" USING btree ("user_id","mode");
--> statement-breakpoint
-- Add associations without modifying historical postings or their saved status.
INSERT INTO lead_search_matches (user_id, lead_id, search_id, search_key, mode, query, score, score_reasons)
SELECT l.user_id, l.id, s.id, COALESCE(s.id::text, 'legacy'), 'priority',
       COALESCE(s.query, l.title), l.score, l.score_reasons
FROM job_leads l LEFT JOIN job_searches s ON s.id = l.search_id AND s.user_id = l.user_id
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION purge_user_data(uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('career.purge', 'on', true);
  DELETE FROM lead_fit_reviews WHERE user_id = uid;
  DELETE FROM lead_search_matches WHERE user_id = uid;
  DELETE FROM career_explorations WHERE user_id = uid;
  DELETE FROM practice_attempts WHERE user_id = uid;
  DELETE FROM interview_preps WHERE user_id = uid;
  DELETE FROM interviews WHERE user_id = uid;
  DELETE FROM stories WHERE user_id = uid;
  DELETE FROM learning_items WHERE user_id = uid;
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
