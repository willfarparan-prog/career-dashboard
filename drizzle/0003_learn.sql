CREATE TABLE "learning_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"status" text DEFAULT 'learning' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "learning_items_user_key_idx" ON "learning_items" USING btree ("user_id","key");--> statement-breakpoint
-- "Delete everything" now covers Learn hub progress too.
CREATE OR REPLACE FUNCTION purge_user_data(uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('career.purge', 'on', true);
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
