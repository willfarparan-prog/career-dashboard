-- Snapshots record exactly what was sent with an application. They are
-- insert-only: UPDATE is always refused, and DELETE only succeeds inside
-- purge_user_data(), the owner's "delete everything" control.
CREATE OR REPLACE FUNCTION snapshots_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('career.purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'snapshots are immutable: % refused', TG_OP USING ERRCODE = 'P0001';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS snapshots_immutable ON snapshots;
--> statement-breakpoint
CREATE TRIGGER snapshots_immutable BEFORE UPDATE OR DELETE ON snapshots FOR EACH ROW EXECUTE FUNCTION snapshots_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION purge_user_data(uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('career.purge', 'on', true);
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
