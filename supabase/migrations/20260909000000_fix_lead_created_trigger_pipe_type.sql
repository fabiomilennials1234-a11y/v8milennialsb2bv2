-- Fix: lead_created trigger was passing 'pipe_whatsapp' (stage value) instead of
-- 'pipe_type' (pipe identifier). This caused the workflow trigger_config pipe
-- filter to be silently ignored — matchesTriggerConfig looks for context.pipe
-- or context.pipe_type, but neither existed in the trigger context.
--
-- Note: leads table only has pipe_whatsapp column. pipe_confirmacao and
-- pipe_propostas are separate tables — leads always enter via pipe_whatsapp.

CREATE OR REPLACE FUNCTION public.trigger_workflow_lead_created()
RETURNS trigger AS $$
BEGIN
  PERFORM public.fire_workflow_trigger(
    NEW.organization_id,
    'lead_created',
    NEW.id,
    jsonb_build_object(
      'trigger', 'lead_created',
      'origin', COALESCE(NEW.origin::text, 'outro'),
      'pipe_type', 'pipe_whatsapp'
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
