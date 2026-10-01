CREATE TABLE "interview_preps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"job_id" uuid NOT NULL,
	"content" jsonb,
	"company_notes" text DEFAULT '' NOT NULL,
	"generated_at" timestamp with time zone,
	"model" text DEFAULT '' NOT NULL,
	"prompt_version" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"job_id" uuid NOT NULL,
	"stage" text DEFAULT 'recruiter_screen' NOT NULL,
	"date" text DEFAULT '' NOT NULL,
	"interviewers" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"debrief" text DEFAULT '' NOT NULL,
	"thank_you_sent" boolean DEFAULT false NOT NULL,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practice_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"job_id" uuid,
	"question" text NOT NULL,
	"competency" text DEFAULT '' NOT NULL,
	"answer" text NOT NULL,
	"feedback" jsonb NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"prompt_version" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"achievement_id" uuid,
	"title" text NOT NULL,
	"format" text DEFAULT 'star' NOT NULL,
	"situation" text DEFAULT '' NOT NULL,
	"task" text DEFAULT '' NOT NULL,
	"action" text DEFAULT '' NOT NULL,
	"result" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"competencies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fact_status" text DEFAULT 'needs_confirmation' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interview_preps" ADD CONSTRAINT "interview_preps_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_attempts" ADD CONSTRAINT "practice_attempts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_achievement_id_achievements_id_fk" FOREIGN KEY ("achievement_id") REFERENCES "public"."achievements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "interview_preps_job_idx" ON "interview_preps" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "interview_preps_user_idx" ON "interview_preps" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "interviews_job_idx" ON "interviews" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "interviews_user_idx" ON "interviews" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "practice_attempts_user_idx" ON "practice_attempts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "stories_user_idx" ON "stories" USING btree ("user_id");--> statement-breakpoint
-- "Delete everything" now covers interview prep too.
CREATE OR REPLACE FUNCTION purge_user_data(uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('career.purge', 'on', true);
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
