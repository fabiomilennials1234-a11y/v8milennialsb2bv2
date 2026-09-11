-- A stage belongs to a funnel. Moving to an equal key in another funnel starts a new stay.
-- Only the existing pipeline_entries trigger consumes this function; no historical backfill.
BEGIN;
CREATE OR REPLACE FUNCTION public.set_pipeline_entry_stage_changed()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF OLD.stage_key IS DISTINCT FROM NEW.stage_key
    OR OLD.pipeline_id IS DISTINCT FROM NEW.pipeline_id THEN
    NEW.stage_changed_at := NOW();
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.set_pipeline_entry_stage_changed() FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
