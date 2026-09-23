-- Restore the exact live function captured before admission optimization.
CREATE OR REPLACE FUNCTION public.trigger_workflow_pipeline_stage_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_url TEXT;
  v_secret TEXT;
  v_pipe_type TEXT;
  v_actor_user_id UUID;
  v_actor_member_id UUID;
BEGIN
  SELECT pip.slug INTO v_pipe_type
  FROM public.pipelines pip
  WHERE pip.id = NEW.pipeline_id AND pip.type = 'system';  -- metric-lint-allow: despacho de gatilho (ver cabeçalho)

  IF v_pipe_type IS NULL THEN RETURN NEW; END IF;

  SELECT value INTO v_url FROM public.cron_config WHERE key = 'campaign_rule_dispatch_url';
  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';

  v_url := replace(v_url, 'campaign-rule-dispatch', 'process-workflow-executions');

  IF v_url IS NULL OR v_secret IS NULL THEN RETURN NEW; END IF;

  v_actor_user_id := auth.uid();
  IF v_actor_user_id IS NOT NULL THEN
    SELECT id INTO v_actor_member_id
    FROM public.team_members
    WHERE user_id = v_actor_user_id
      AND organization_id = NEW.organization_id
      AND is_active = true
    LIMIT 1;
  END IF;

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
      -- ── CONTEXTO ÚNICO (SCRUM-627, D-1) ──
      -- Mesmo shape do gatilho custom abaixo; `pipe_type` é ECO legado (slug,
      -- só existe aqui porque este funil é de sistema) e some na W6.
      'context', jsonb_build_object(
        'trigger', 'stage_changed',
        'pipeline_id', NEW.pipeline_id,
        'pipe_type', v_pipe_type,
        'pipeline_entry_id', NEW.id,
        'deal_id', NEW.deal_id,
        'stage_id', NEW.stage_id,
        'stage_key', NEW.stage_key,
        'from_stage', OLD.stage_key,
        'from_stage_id', OLD.stage_id,
        'to_stage', NEW.stage_key,
        'changed_by_user_id', v_actor_user_id,
        'changed_by_member_id', v_actor_member_id
      )
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;
