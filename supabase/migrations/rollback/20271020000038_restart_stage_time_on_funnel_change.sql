-- Restore the pre-change stage-key-only clock and its original effective privileges.
-- Timestamps already recorded remain untouched; no attempt to reconstruct historical dates.
BEGIN;
CREATE OR REPLACE FUNCTION public.set_pipeline_entry_stage_changed()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF OLD.stage_key IS DISTINCT FROM NEW.stage_key THEN
    NEW.stage_changed_at := NOW();
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.set_pipeline_entry_stage_changed() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_pipeline_entry_stage_changed() TO PUBLIC, anon, authenticated, service_role;
COMMIT;
