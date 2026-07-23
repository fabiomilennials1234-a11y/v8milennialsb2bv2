-- PG Triggers for custom pipeline workflow integration
-- Fires lead_created when a lead enters a custom pipeline
-- Fires stage_changed when a lead moves between stages in a custom pipeline

-- 1. INSERT trigger: fire lead_created + stage_changed when lead enters custom pipeline
CREATE OR REPLACE FUNCTION public.trigger_workflow_custom_pipe_entry()
RETURNS trigger AS $$
BEGIN
  -- Fire lead_created with pipeline_id context
  -- Only workflows with filter_pipeline_id matching will fire (guard in matchesTriggerConfig)
  PERFORM public.fire_workflow_trigger(
    NEW.organization_id,
    'lead_created',
    NEW.lead_id,
    jsonb_build_object(
      'trigger', 'lead_created',
      'pipeline_id', NEW.pipeline_id::text
    )
  );

  -- Fire stage_changed so workflows on specific stages also trigger
  PERFORM public.fire_workflow_trigger(
    NEW.organization_id,
    'stage_changed',
    NEW.lead_id,
    jsonb_build_object(
      'trigger', 'stage_changed',
      'pipeline_id', NEW.pipeline_id::text,
      'to_stage', (SELECT stage_key FROM public.custom_pipeline_stages WHERE id = NEW.stage_id LIMIT 1)
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_workflow_custom_pipe_entry ON public.custom_pipe_entries;
CREATE TRIGGER trg_workflow_custom_pipe_entry
  AFTER INSERT ON public.custom_pipe_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_workflow_custom_pipe_entry();

-- 2. UPDATE trigger: fire stage_changed when lead moves between stages
CREATE OR REPLACE FUNCTION public.trigger_workflow_custom_pipe_stage_change()
RETURNS trigger AS $$
BEGIN
  -- Only fire if stage actually changed
  IF OLD.stage_id IS DISTINCT FROM NEW.stage_id THEN
    PERFORM public.fire_workflow_trigger(
      NEW.organization_id,
      'stage_changed',
      NEW.lead_id,
      jsonb_build_object(
        'trigger', 'stage_changed',
        'pipeline_id', NEW.pipeline_id::text,
        'from_stage', (SELECT stage_key FROM public.custom_pipeline_stages WHERE id = OLD.stage_id LIMIT 1),
        'to_stage', (SELECT stage_key FROM public.custom_pipeline_stages WHERE id = NEW.stage_id LIMIT 1)
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_workflow_custom_pipe_stage_change ON public.custom_pipe_entries;
CREATE TRIGGER trg_workflow_custom_pipe_stage_change
  AFTER UPDATE ON public.custom_pipe_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_workflow_custom_pipe_stage_change();
