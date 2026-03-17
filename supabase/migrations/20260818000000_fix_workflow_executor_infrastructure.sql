-- =====================================================
-- Fix Workflow Executor Infrastructure
--
-- 1. Add 'workflow' to runtime_logs module CHECK
-- 2. Create find_leads_no_reply RPC
-- 3. Cron jobs: use cron_config instead of app.settings
-- 4. PG trigger for stage_changed on 3 pipes
-- 5. fire_workflow_trigger: include trigger_config in context
-- =====================================================

-- ─── 1. runtime_logs: add 'workflow' to CHECK constraint ─────────────────────

ALTER TABLE public.runtime_logs
  DROP CONSTRAINT IF EXISTS runtime_logs_module_check;

ALTER TABLE public.runtime_logs
  ADD CONSTRAINT runtime_logs_module_check
  CHECK (module IN (
    'pipe_dispatch', 'copilot', 'campaign', 'webhook',
    'followup', 'outbound', 'permission', 'workflow'
  ));

-- ─── 2. RPC: find_leads_no_reply ─────────────────────────────────────────────
-- Used by processPeriodicTriggers() in process-workflow-executions
-- Finds leads whose last conversation activity is before the cutoff
-- and have no incoming WhatsApp message since the cutoff.

CREATE OR REPLACE FUNCTION public.find_leads_no_reply(
  p_organization_id UUID,
  p_cutoff TIMESTAMPTZ,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (id UUID) AS $$
  SELECT DISTINCT l.id
  FROM public.leads l
  JOIN public.conversations c ON c.lead_id = l.id
  WHERE l.organization_id = p_organization_id
    AND c.last_message_at < p_cutoff
    AND c.last_message_at IS NOT NULL
    AND (l.ai_disabled IS NULL OR l.ai_disabled = false)
    AND NOT EXISTS (
      SELECT 1 FROM public.whatsapp_messages wm
      WHERE wm.lead_id = l.id
        AND wm.direction = 'incoming'
        AND wm.created_at > p_cutoff
    )
  ORDER BY l.id
  LIMIT p_limit;
$$ LANGUAGE sql SECURITY DEFINER;

-- ─── 3. Cron jobs: read from cron_config instead of app.settings ─────────────

-- 3a. Function for process-workflow-executions (default mode)
CREATE OR REPLACE FUNCTION public.invoke_process_workflow_executions()
RETURNS void AS $$
DECLARE
  v_url TEXT;
  v_secret TEXT;
BEGIN
  SELECT value INTO v_url FROM public.cron_config WHERE key = 'campaign_rule_dispatch_url';
  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';

  v_url := replace(v_url, 'campaign-rule-dispatch', 'process-workflow-executions');

  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING '[workflow-cron] cron_config missing: url=%, secret=%', v_url, v_secret IS NOT NULL;
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[workflow-cron] invoke_process_workflow_executions failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3b. Function for workflow-cron-triggers (cron_triggers mode)
CREATE OR REPLACE FUNCTION public.invoke_workflow_cron_triggers()
RETURNS void AS $$
DECLARE
  v_url TEXT;
  v_secret TEXT;
BEGIN
  SELECT value INTO v_url FROM public.cron_config WHERE key = 'campaign_rule_dispatch_url';
  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';

  v_url := replace(v_url, 'campaign-rule-dispatch', 'process-workflow-executions');

  IF v_url IS NULL OR v_secret IS NULL THEN RETURN; END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{"mode":"cron_triggers"}'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[workflow-cron] invoke_workflow_cron_triggers failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3c. Re-register cron jobs using the new functions
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Unschedule old jobs
    PERFORM cron.unschedule('process-workflow-executions')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-workflow-executions');

    PERFORM cron.unschedule('workflow-cron-triggers')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'workflow-cron-triggers');

    -- Schedule new jobs using cron_config-based functions
    PERFORM cron.schedule(
      'process-workflow-executions',
      '* * * * *',
      'SELECT public.invoke_process_workflow_executions()'
    );

    PERFORM cron.schedule(
      'workflow-cron-triggers',
      '* * * * *',
      'SELECT public.invoke_workflow_cron_triggers()'
    );
  END IF;
END $outer$;

-- ─── 4. PG trigger: stage_changed on 3 pipes ────────────────────────────────
-- Covers stage changes made by backend/API/automations (not just frontend).
-- Calls the Edge Function via pg_net with fire_trigger mode.

CREATE OR REPLACE FUNCTION public.trigger_workflow_stage_changed()
RETURNS TRIGGER AS $$
DECLARE
  v_url TEXT;
  v_secret TEXT;
  v_pipe_type TEXT;
BEGIN
  -- Derive pipe_type from table name: pipe_whatsapp → whatsapp
  v_pipe_type := replace(TG_TABLE_NAME, 'pipe_', '');

  SELECT value INTO v_url FROM public.cron_config WHERE key = 'campaign_rule_dispatch_url';
  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';

  v_url := replace(v_url, 'campaign-rule-dispatch', 'process-workflow-executions');

  IF v_url IS NULL OR v_secret IS NULL THEN RETURN NEW; END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := jsonb_build_object(
      'mode', 'fire_trigger',
      'organization_id', NEW.organization_id,
      'trigger_type', 'stage_changed',
      'lead_id', NEW.lead_id,
      'context', jsonb_build_object(
        'trigger', 'stage_changed',
        'pipe_type', v_pipe_type,
        'from_stage', OLD.status,
        'to_stage', NEW.status
      )
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never break the UPDATE if pg_net fails
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply to 3 pipes
DROP TRIGGER IF EXISTS trg_workflow_stage_changed_whatsapp ON public.pipe_whatsapp;
CREATE TRIGGER trg_workflow_stage_changed_whatsapp
  AFTER UPDATE OF status ON public.pipe_whatsapp
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.trigger_workflow_stage_changed();

DROP TRIGGER IF EXISTS trg_workflow_stage_changed_confirmacao ON public.pipe_confirmacao;
CREATE TRIGGER trg_workflow_stage_changed_confirmacao
  AFTER UPDATE OF status ON public.pipe_confirmacao
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.trigger_workflow_stage_changed();

DROP TRIGGER IF EXISTS trg_workflow_stage_changed_propostas ON public.pipe_propostas;
CREATE TRIGGER trg_workflow_stage_changed_propostas
  AFTER UPDATE OF status ON public.pipe_propostas
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.trigger_workflow_stage_changed();

-- ─── 5. fire_workflow_trigger: include trigger_config in context ─────────────
-- Allows downstream executor/edge function to validate config match.

CREATE OR REPLACE FUNCTION public.fire_workflow_trigger(
  p_organization_id UUID,
  p_trigger_type TEXT,
  p_lead_id UUID,
  p_context JSONB DEFAULT '{}'::jsonb
) RETURNS INT AS $$
DECLARE
  v_workflow RECORD;
  v_count INT := 0;
BEGIN
  FOR v_workflow IN
    SELECT id, trigger_config
    FROM public.workflows
    WHERE organization_id = p_organization_id
      AND trigger_type = p_trigger_type
      AND is_active = true
  LOOP
    INSERT INTO public.workflow_executions (
      workflow_id, organization_id, lead_id, status, context
    ) VALUES (
      v_workflow.id, p_organization_id, p_lead_id, 'running',
      p_context || jsonb_build_object(
        'trigger_type', p_trigger_type,
        'trigger_config', v_workflow.trigger_config
      )
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
