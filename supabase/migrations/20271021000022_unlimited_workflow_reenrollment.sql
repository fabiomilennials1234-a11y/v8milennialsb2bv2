-- Enabled reenrollment has no historical quantity or cooldown limit.
-- Keep compatibility columns untouched for old clients and rollback.
-- Retry/continuation of an existing execution uses UPDATE and is unaffected.
-- Separate pipeline entries remain separate enrollment subjects (ADR-0023).
CREATE OR REPLACE FUNCTION public.guard_workflow_reenrollment()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  settings record;
  previous_count bigint;
  has_active boolean;
BEGIN
  SELECT re_enrollment_enabled
    INTO settings FROM public.workflows
    WHERE id = NEW.workflow_id AND organization_id = NEW.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workflow unavailable for organization' USING ERRCODE = '23514';
  END IF;
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;
  -- Lock only this subject, never the entire workflow/organization.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    NEW.organization_id::text || ':' || NEW.workflow_id::text || ':' || NEW.lead_id::text, 0));
  SELECT count(*), bool_or(status IN ('running','processing','waiting_response','paused'))
    INTO previous_count, has_active
    FROM public.workflow_executions
    WHERE organization_id = NEW.organization_id AND workflow_id = NEW.workflow_id
      AND lead_id = NEW.lead_id
      AND (NEW.pipeline_entry_id IS NULL OR pipeline_entry_id = NEW.pipeline_entry_id);
  -- An in-flight execution always owns the subject. With reenrollment off,
  -- any previous participation (including failed/cancelled) blocks reentry.
  IF has_active THEN RETURN NULL; END IF;
  IF previous_count > 0 AND NOT coalesce(settings.re_enrollment_enabled, false) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_workflow_reenrollment() FROM PUBLIC, anon, authenticated;
