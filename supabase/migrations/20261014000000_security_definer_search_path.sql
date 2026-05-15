-- ============================================================================
-- W2-2: Add SET search_path = public to SECURITY DEFINER functions
-- that are missing it. ALTER FUNCTION is non-destructive — only sets
-- the GUC without touching the function body.
-- ============================================================================

-- From 20260802000000_workflow_executor_infrastructure.sql
-- Prod has 5-param signature (includes p_triggered_by_execution_id uuid)
ALTER FUNCTION public.fire_workflow_trigger(uuid, text, uuid, jsonb, uuid)
  SET search_path = public;

ALTER FUNCTION public.trigger_workflow_lead_created()
  SET search_path = public;

ALTER FUNCTION public.trigger_workflow_tag_added()
  SET search_path = public;

ALTER FUNCTION public.trigger_workflow_score_reached()
  SET search_path = public;

ALTER FUNCTION public.trigger_workflow_lead_assigned()
  SET search_path = public;

ALTER FUNCTION public.trigger_workflow_field_changed()
  SET search_path = public;

ALTER FUNCTION public.trigger_workflow_meeting_confirmed()
  SET search_path = public;

ALTER FUNCTION public.trigger_workflow_proposal_result()
  SET search_path = public;

ALTER FUNCTION public.trigger_workflow_campaign_status()
  SET search_path = public;
