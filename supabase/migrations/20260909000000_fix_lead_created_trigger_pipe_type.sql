-- Fix: lead_created trigger was passing 'pipe_whatsapp' (stage value) instead of
-- 'pipe_type' (pipe identifier). This caused the workflow trigger_config pipe
-- filter to be silently ignored — matchesTriggerConfig looks for context.pipe
-- or context.pipe_type, but neither existed in the trigger context.

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
      'pipe_type', CASE
        WHEN NEW.pipe_propostas IS NOT NULL AND NEW.pipe_propostas != '' THEN 'pipe_propostas'
        WHEN NEW.pipe_confirmacao IS NOT NULL AND NEW.pipe_confirmacao != '' THEN 'pipe_confirmacao'
        ELSE 'pipe_whatsapp'
      END
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
