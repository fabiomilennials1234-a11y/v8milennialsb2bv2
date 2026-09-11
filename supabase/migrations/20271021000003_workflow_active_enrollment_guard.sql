-- Also close the in-flight check/insert race when reenrollment is enabled.
-- Retry/continuation of an existing execution uses UPDATE and is unaffected.
-- Separate pipeline entries remain separate enrollment subjects (ADR-0023).
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
  -- Lock only this subject, never the entire workflow/organization.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    NEW.organization_id::text || ':' || NEW.workflow_id::text || ':' || NEW.lead_id::text, 0));
  SELECT count(*), max(started_at), bool_or(status IN ('running','processing','waiting_response','paused'))
    INTO previous_count, latest_start, has_active
    FROM public.workflow_executions
    WHERE organization_id = NEW.organization_id AND workflow_id = NEW.workflow_id
      AND lead_id = NEW.lead_id
      AND (NEW.pipeline_entry_id IS NULL OR pipeline_entry_id = NEW.pipeline_entry_id);
  -- All prior enrollments count, including cancelled/failed ones. A terminal
  -- failure must not silently reset a user-defined sending limit.
  IF has_active THEN RETURN NULL; END IF;
  IF previous_count > 0 AND (
    NOT settings.re_enrollment_enabled
    OR previous_count >= greatest(coalesce(settings.re_enrollment_max_times, 1), 1)
    OR latest_start + pg_catalog.make_interval(days => greatest(coalesce(settings.re_enrollment_cooldown_days, 30), 0)) > pg_catalog.clock_timestamp()
  ) THEN RETURN NULL; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_workflow_reenrollment() FROM PUBLIC, anon, authenticated;
