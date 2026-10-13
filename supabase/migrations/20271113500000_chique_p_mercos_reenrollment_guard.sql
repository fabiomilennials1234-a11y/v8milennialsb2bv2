-- Chique Distribuidora turned reenrollment on for P. mercos in the guided
-- editor (draft revision 32, 2026-10-08), but the guided draft never reaches
-- workflows.re_enrollment_enabled, which is what the guard reads. Moving
-- already-enrolled cards back into the stage was silently dropped.
-- Same scoped exception as Agafarma/R. mercos; every other tenant untouched.
CREATE OR REPLACE FUNCTION public.guard_workflow_reenrollment()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  settings record;
  previous_count bigint;
  latest_start timestamptz;
  has_active boolean;
BEGIN
  SELECT re_enrollment_enabled, re_enrollment_max_times, re_enrollment_cooldown_days
    INTO settings FROM public.workflows
    WHERE id = NEW.workflow_id AND organization_id = NEW.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workflow unavailable for organization' USING ERRCODE = '23514';
  END IF;
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    NEW.organization_id::text || ':' || NEW.workflow_id::text || ':' || NEW.lead_id::text, 0));
  SELECT count(*), max(started_at), bool_or(status IN ('running','processing','waiting_response','paused'))
    INTO previous_count, latest_start, has_active
    FROM public.workflow_executions
    WHERE organization_id = NEW.organization_id AND workflow_id = NEW.workflow_id
      AND lead_id = NEW.lead_id
      AND (NEW.pipeline_entry_id IS NULL OR pipeline_entry_id = NEW.pipeline_entry_id);
  IF has_active THEN RETURN NULL; END IF;

  IF NEW.organization_id = '38f3bea4-44c6-4732-bb20-065f547a7ed8'::uuid
     AND NEW.workflow_id IN (
       '765711a7-7409-40bf-9eef-8925629d534e'::uuid, -- Agafarma
       'f7cc3e94-b174-452c-a1a7-e2d5085c2b76'::uuid, -- R. mercos
       'adb843a0-b677-4aa5-979e-6bd3cee4db0d'::uuid  -- P. mercos
     )
     AND coalesce(settings.re_enrollment_enabled, false) THEN
    RETURN NEW;
  END IF;

  IF previous_count > 0 AND (
    NOT settings.re_enrollment_enabled
    OR previous_count >= greatest(coalesce(settings.re_enrollment_max_times, 1), 1)
    OR latest_start + pg_catalog.make_interval(days => greatest(coalesce(settings.re_enrollment_cooldown_days, 30), 0)) > pg_catalog.clock_timestamp()
  ) THEN RETURN NULL; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_workflow_reenrollment() FROM PUBLIC, anon, authenticated;

-- Apply the setting the customer already chose in the guided draft.
-- Dado de UM cliente: só existe no banco de prod. Em banco novo (CI,
-- `supabase start`, branch efêmera) o workflow não existe e o arquivo pula;
-- já ligado (reaplicação) também pula. Presente e desligado sem a escolha no
-- rascunho continua sendo erro — é o caso que a trava protege.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.workflows
     WHERE id = 'adb843a0-b677-4aa5-979e-6bd3cee4db0d'::uuid
       AND organization_id = '38f3bea4-44c6-4732-bb20-065f547a7ed8'::uuid
       AND NOT (is_active AND re_enrollment_enabled)
  ) THEN
    RAISE NOTICE 'P. mercos (Chique) ausente ou já ligado neste banco — nada a fazer.';
    RETURN;
  END IF;

  UPDATE public.workflows SET re_enrollment_enabled = true
  WHERE id = 'adb843a0-b677-4aa5-979e-6bd3cee4db0d'::uuid
    AND organization_id = '38f3bea4-44c6-4732-bb20-065f547a7ed8'::uuid
    AND is_active AND NOT re_enrollment_enabled
    AND EXISTS (
      SELECT 1 FROM public.workflow_guided_drafts d
      WHERE d.workflow_id = 'adb843a0-b677-4aa5-979e-6bd3cee4db0d'::uuid
        AND d.organization_id = '38f3bea4-44c6-4732-bb20-065f547a7ed8'::uuid
        AND (d.settings ->> 're_enrollment_enabled')::boolean
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P. mercos is not an active, disabled workflow with reenrollment chosen in its draft';
  END IF;
END;
$$;
