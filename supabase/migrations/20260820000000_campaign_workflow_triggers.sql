-- =====================================================
-- Campaign ↔ Workflow integration triggers
-- 5 new PG triggers that fire workflow executions
-- Uses fire_workflow_trigger() — no pg_net needed
-- =====================================================

-- 1. lead_added_to_campaign: AFTER INSERT on campanha_leads
CREATE OR REPLACE FUNCTION public.trigger_workflow_lead_added_to_campaign()
RETURNS trigger AS $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT organization_id INTO v_org_id FROM public.leads WHERE id = NEW.lead_id;

  IF v_org_id IS NOT NULL THEN
    PERFORM public.fire_workflow_trigger(
      v_org_id,
      'lead_added_to_campaign',
      NEW.lead_id,
      jsonb_build_object(
        'trigger', 'lead_added_to_campaign',
        'campanha_id', NEW.campanha_id::text,
        'stage_id', COALESCE(NEW.stage_id::text, '')
      )
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_workflow_lead_added_to_campaign ON public.campanha_leads;
CREATE TRIGGER trg_workflow_lead_added_to_campaign
  AFTER INSERT ON public.campanha_leads
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_workflow_lead_added_to_campaign();


-- 2. lead_removed_from_campaign: AFTER DELETE on campanha_leads
CREATE OR REPLACE FUNCTION public.trigger_workflow_lead_removed_from_campaign()
RETURNS trigger AS $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT organization_id INTO v_org_id FROM public.leads WHERE id = OLD.lead_id;

  IF v_org_id IS NOT NULL THEN
    PERFORM public.fire_workflow_trigger(
      v_org_id,
      'lead_removed_from_campaign',
      OLD.lead_id,
      jsonb_build_object(
        'trigger', 'lead_removed_from_campaign',
        'campanha_id', OLD.campanha_id::text
      )
    );
  END IF;

  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_workflow_lead_removed_from_campaign ON public.campanha_leads;
CREATE TRIGGER trg_workflow_lead_removed_from_campaign
  AFTER DELETE ON public.campanha_leads
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_workflow_lead_removed_from_campaign();


-- 3. campaign_completed: AFTER UPDATE of stage_id on campanha_leads (last stage)
CREATE OR REPLACE FUNCTION public.trigger_workflow_campaign_completed()
RETURNS trigger AS $$
DECLARE
  v_org_id uuid;
  v_is_last_stage boolean;
BEGIN
  IF NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;

  -- Check if the new stage is the last stage in the campaign (highest position)
  SELECT NOT EXISTS (
    SELECT 1 FROM public.campanha_stages cs
    WHERE cs.campanha_id = NEW.campanha_id
      AND cs.position > (
        SELECT position FROM public.campanha_stages WHERE id = NEW.stage_id
      )
  ) INTO v_is_last_stage;

  IF NOT v_is_last_stage THEN
    RETURN NEW;
  END IF;

  SELECT organization_id INTO v_org_id FROM public.leads WHERE id = NEW.lead_id;

  IF v_org_id IS NOT NULL THEN
    PERFORM public.fire_workflow_trigger(
      v_org_id,
      'campaign_completed',
      NEW.lead_id,
      jsonb_build_object(
        'trigger', 'campaign_completed',
        'campanha_id', NEW.campanha_id::text,
        'stage_id', NEW.stage_id::text
      )
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_workflow_campaign_completed ON public.campanha_leads;
CREATE TRIGGER trg_workflow_campaign_completed
  AFTER UPDATE OF stage_id ON public.campanha_leads
  FOR EACH ROW
  WHEN (OLD.stage_id IS DISTINCT FROM NEW.stage_id)
  EXECUTE FUNCTION public.trigger_workflow_campaign_completed();


-- 4. campaign_lead_replied: when scheduled_campaign_messages goes waiting_response → response_received
CREATE OR REPLACE FUNCTION public.trigger_workflow_campaign_lead_replied()
RETURNS trigger AS $$
DECLARE
  v_org_id uuid;
BEGIN
  IF OLD.status = 'waiting_response' AND NEW.status = 'response_received' THEN
    SELECT organization_id INTO v_org_id FROM public.leads WHERE id = NEW.lead_id;

    IF v_org_id IS NOT NULL THEN
      PERFORM public.fire_workflow_trigger(
        v_org_id,
        'campaign_lead_replied',
        NEW.lead_id,
        jsonb_build_object(
          'trigger', 'campaign_lead_replied',
          'campanha_id', NEW.campanha_id::text
        )
      );
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_workflow_campaign_lead_replied ON public.scheduled_campaign_messages;
CREATE TRIGGER trg_workflow_campaign_lead_replied
  AFTER UPDATE OF status ON public.scheduled_campaign_messages
  FOR EACH ROW
  WHEN (OLD.status = 'waiting_response' AND NEW.status = 'response_received')
  EXECUTE FUNCTION public.trigger_workflow_campaign_lead_replied();


-- 5. campaign_lead_no_reply: when scheduled_campaign_messages goes waiting_response → timed_out
CREATE OR REPLACE FUNCTION public.trigger_workflow_campaign_lead_no_reply()
RETURNS trigger AS $$
DECLARE
  v_org_id uuid;
BEGIN
  IF OLD.status = 'waiting_response' AND NEW.status = 'timed_out' THEN
    SELECT organization_id INTO v_org_id FROM public.leads WHERE id = NEW.lead_id;

    IF v_org_id IS NOT NULL THEN
      PERFORM public.fire_workflow_trigger(
        v_org_id,
        'campaign_lead_no_reply',
        NEW.lead_id,
        jsonb_build_object(
          'trigger', 'campaign_lead_no_reply',
          'campanha_id', NEW.campanha_id::text
        )
      );
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_workflow_campaign_lead_no_reply ON public.scheduled_campaign_messages;
CREATE TRIGGER trg_workflow_campaign_lead_no_reply
  AFTER UPDATE OF status ON public.scheduled_campaign_messages
  FOR EACH ROW
  WHEN (OLD.status = 'waiting_response' AND NEW.status = 'timed_out')
  EXECUTE FUNCTION public.trigger_workflow_campaign_lead_no_reply();
