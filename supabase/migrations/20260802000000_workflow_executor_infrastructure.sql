-- =====================================================
-- Workflow Executor Infrastructure
-- Adds: next_run_at column, claim RPC, PG triggers for
-- firing workflows, pg_cron job for executor
-- =====================================================

-- 1. Add next_run_at to workflow_executions for delay/scheduling
ALTER TABLE public.workflow_executions
  ADD COLUMN IF NOT EXISTS next_run_at timestamptz;

-- Index for the claim query
CREATE INDEX IF NOT EXISTS idx_workflow_executions_claim
  ON public.workflow_executions(status, next_run_at)
  WHERE status IN ('running', 'processing');

-- 2. Claim RPC — atomic batch claim with FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION public.claim_workflow_executions(batch_size int DEFAULT 20)
RETURNS SETOF public.workflow_executions AS $$
  UPDATE public.workflow_executions
  SET status = 'processing'
  WHERE id IN (
    SELECT id FROM public.workflow_executions
    WHERE status = 'running'
      AND (next_run_at IS NULL OR next_run_at <= NOW())
    ORDER BY started_at ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$ LANGUAGE sql;

-- 3. Fire workflow trigger — called by PG triggers and edge functions
-- Finds matching active workflows and creates execution records
CREATE OR REPLACE FUNCTION public.fire_workflow_trigger(
  p_organization_id uuid,
  p_trigger_type text,
  p_lead_id uuid,
  p_context jsonb DEFAULT '{}'::jsonb
) RETURNS int AS $$
DECLARE
  v_workflow record;
  v_count int := 0;
BEGIN
  FOR v_workflow IN
    SELECT id, trigger_config
    FROM public.workflows
    WHERE organization_id = p_organization_id
      AND trigger_type = p_trigger_type
      AND is_active = true
  LOOP
    -- Insert execution (the executor will validate trigger_config match)
    INSERT INTO public.workflow_executions (
      workflow_id, organization_id, lead_id, status, context
    ) VALUES (
      v_workflow.id, p_organization_id, p_lead_id, 'running',
      p_context || jsonb_build_object('trigger_type', p_trigger_type)
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. PG Trigger: lead_created
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

DROP TRIGGER IF EXISTS trg_workflow_lead_created ON public.leads;
CREATE TRIGGER trg_workflow_lead_created
  AFTER INSERT ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_workflow_lead_created();

-- 5. PG Trigger: tag_added
CREATE OR REPLACE FUNCTION public.trigger_workflow_tag_added()
RETURNS trigger AS $$
DECLARE
  v_lead record;
  v_tag record;
BEGIN
  SELECT organization_id INTO v_lead FROM public.leads WHERE id = NEW.lead_id;
  SELECT name INTO v_tag FROM public.tags WHERE id = NEW.tag_id;

  IF v_lead.organization_id IS NOT NULL THEN
    PERFORM public.fire_workflow_trigger(
      v_lead.organization_id,
      'tag_added',
      NEW.lead_id,
      jsonb_build_object(
        'trigger', 'tag_added',
        'tag_id', NEW.tag_id::text,
        'tag_name', COALESCE(v_tag.name, '')
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_workflow_tag_added ON public.lead_tags;
CREATE TRIGGER trg_workflow_tag_added
  AFTER INSERT ON public.lead_tags
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_workflow_tag_added();

-- 6. PG Trigger: score_reached
CREATE OR REPLACE FUNCTION public.trigger_workflow_score_reached()
RETURNS trigger AS $$
BEGIN
  IF NEW.qualification_score IS DISTINCT FROM OLD.qualification_score
     AND NEW.qualification_score IS NOT NULL THEN
    PERFORM public.fire_workflow_trigger(
      NEW.organization_id,
      'score_reached',
      NEW.id,
      jsonb_build_object(
        'trigger', 'score_reached',
        'score', NEW.qualification_score,
        'previous_score', COALESCE(OLD.qualification_score, 0)
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_workflow_score_reached ON public.leads;
CREATE TRIGGER trg_workflow_score_reached
  AFTER UPDATE OF qualification_score ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_workflow_score_reached();

-- 7. PG Trigger: lead_assigned (sdr_id or closer_id changed)
CREATE OR REPLACE FUNCTION public.trigger_workflow_lead_assigned()
RETURNS trigger AS $$
DECLARE
  v_role text;
BEGIN
  IF NEW.sdr_id IS DISTINCT FROM OLD.sdr_id AND NEW.sdr_id IS NOT NULL THEN
    v_role := 'sdr';
  ELSIF NEW.closer_id IS DISTINCT FROM OLD.closer_id AND NEW.closer_id IS NOT NULL THEN
    v_role := 'closer';
  ELSE
    RETURN NEW;
  END IF;

  PERFORM public.fire_workflow_trigger(
    NEW.organization_id,
    'lead_assigned',
    NEW.id,
    jsonb_build_object(
      'trigger', 'lead_assigned',
      'role', v_role,
      'assigned_to', COALESCE(
        CASE WHEN v_role = 'sdr' THEN NEW.sdr_id ELSE NEW.closer_id END,
        '00000000-0000-0000-0000-000000000000'
      )::text
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_workflow_lead_assigned ON public.leads;
CREATE TRIGGER trg_workflow_lead_assigned
  AFTER UPDATE OF sdr_id, closer_id ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_workflow_lead_assigned();

-- 8. PG Trigger: field_changed (generic lead field changes)
CREATE OR REPLACE FUNCTION public.trigger_workflow_field_changed()
RETURNS trigger AS $$
DECLARE
  v_fields text[] := ARRAY['company', 'segment', 'urgency', 'faturamento', 'rating', 'email', 'phone', 'name'];
  v_field text;
  v_old_val text;
  v_new_val text;
BEGIN
  FOREACH v_field IN ARRAY v_fields LOOP
    EXECUTE format('SELECT ($1).%I::text, ($2).%I::text', v_field, v_field)
      INTO v_old_val, v_new_val
      USING OLD, NEW;

    IF v_old_val IS DISTINCT FROM v_new_val THEN
      PERFORM public.fire_workflow_trigger(
        NEW.organization_id,
        'field_changed',
        NEW.id,
        jsonb_build_object(
          'trigger', 'field_changed',
          'field_name', v_field,
          'old_value', COALESCE(v_old_val, ''),
          'new_value', COALESCE(v_new_val, '')
        )
      );
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_workflow_field_changed ON public.leads;
CREATE TRIGGER trg_workflow_field_changed
  AFTER UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_workflow_field_changed();

-- 9. PG Trigger: meeting_confirmed (pipe_confirmacao.is_confirmed changed to true)
CREATE OR REPLACE FUNCTION public.trigger_workflow_meeting_confirmed()
RETURNS trigger AS $$
DECLARE
  v_org_id uuid;
BEGIN
  IF NEW.is_confirmed = true AND (OLD.is_confirmed IS NULL OR OLD.is_confirmed = false) THEN
    SELECT organization_id INTO v_org_id FROM public.leads WHERE id = NEW.lead_id;
    IF v_org_id IS NOT NULL THEN
      PERFORM public.fire_workflow_trigger(
        v_org_id,
        'meeting_confirmed',
        NEW.lead_id,
        jsonb_build_object(
          'trigger', 'meeting_confirmed',
          'meeting_date', COALESCE(NEW.meeting_date::text, '')
        )
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_workflow_meeting_confirmed ON public.pipe_confirmacao;
CREATE TRIGGER trg_workflow_meeting_confirmed
  AFTER UPDATE OF is_confirmed ON public.pipe_confirmacao
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_workflow_meeting_confirmed();

-- 10. PG Trigger: proposal_accepted / proposal_lost
CREATE OR REPLACE FUNCTION public.trigger_workflow_proposal_result()
RETURNS trigger AS $$
DECLARE
  v_org_id uuid;
  v_trigger_type text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT organization_id INTO v_org_id FROM public.leads WHERE id = NEW.lead_id;
    IF v_org_id IS NULL THEN RETURN NEW; END IF;

    IF NEW.status = 'vendido' THEN
      v_trigger_type := 'proposal_accepted';
    ELSIF NEW.status = 'perdido' THEN
      v_trigger_type := 'proposal_lost';
    ELSE
      RETURN NEW;
    END IF;

    PERFORM public.fire_workflow_trigger(
      v_org_id,
      v_trigger_type,
      NEW.lead_id,
      jsonb_build_object(
        'trigger', v_trigger_type,
        'status', NEW.status,
        'previous_status', COALESCE(OLD.status, '')
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_workflow_proposal_result ON public.pipe_propostas;
CREATE TRIGGER trg_workflow_proposal_result
  AFTER UPDATE OF status ON public.pipe_propostas
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_workflow_proposal_result();

-- 11. PG Trigger: campaign_status_changed (campanha_leads stage change)
CREATE OR REPLACE FUNCTION public.trigger_workflow_campaign_status()
RETURNS trigger AS $$
DECLARE
  v_org_id uuid;
  v_stage_name text;
BEGIN
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id AND NEW.stage_id IS NOT NULL THEN
    SELECT organization_id INTO v_org_id FROM public.leads WHERE id = NEW.lead_id;
    SELECT name INTO v_stage_name FROM public.campanha_stages WHERE id = NEW.stage_id;

    IF v_org_id IS NOT NULL THEN
      PERFORM public.fire_workflow_trigger(
        v_org_id,
        'campaign_status_changed',
        NEW.lead_id,
        jsonb_build_object(
          'trigger', 'campaign_status_changed',
          'campanha_id', NEW.campanha_id::text,
          'stage_id', NEW.stage_id::text,
          'stage_name', COALESCE(v_stage_name, '')
        )
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_workflow_campaign_status ON public.campanha_leads;
CREATE TRIGGER trg_workflow_campaign_status
  AFTER UPDATE OF stage_id ON public.campanha_leads
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_workflow_campaign_status();

-- 12. pg_cron: process-workflow-executions every 1 minute
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Remove old job if exists
    PERFORM cron.unschedule('process-workflow-executions')
    WHERE EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'process-workflow-executions'
    );

    -- Schedule new job
    PERFORM cron.schedule(
      'process-workflow-executions',
      '* * * * *',
      $cron$
      SELECT net.http_post(
        url := current_setting('app.settings.supabase_url') || '/functions/v1/process-workflow-executions',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', current_setting('app.settings.cron_secret')
        ),
        body := '{}'::jsonb
      );
      $cron$
    );
  END IF;
END $outer$;

-- 13. pg_cron: workflow cron triggers (checks cron-type workflows every minute)
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('workflow-cron-triggers')
    WHERE EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'workflow-cron-triggers'
    );

    PERFORM cron.schedule(
      'workflow-cron-triggers',
      '* * * * *',
      $cron$
      SELECT net.http_post(
        url := current_setting('app.settings.supabase_url') || '/functions/v1/process-workflow-executions',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', current_setting('app.settings.cron_secret')
        ),
        body := '{"mode":"cron_triggers"}'::jsonb
      );
      $cron$
    );
  END IF;
END $outer$;

-- 14. RLS policy for service_role on workflow_executions (for Edge Function inserts)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'workflow_executions'
      AND policyname = 'workflow_executions_service_role'
  ) THEN
    CREATE POLICY "workflow_executions_service_role" ON public.workflow_executions
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 15. RLS policy for service_role on workflow_execution_steps
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'workflow_execution_steps'
      AND policyname = 'workflow_execution_steps_service_role'
  ) THEN
    CREATE POLICY "workflow_execution_steps_service_role" ON public.workflow_execution_steps
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
