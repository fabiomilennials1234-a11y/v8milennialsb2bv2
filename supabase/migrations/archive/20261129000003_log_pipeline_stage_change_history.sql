-- Recria o logging de mudança de etapa em lead_history.
--
-- Contexto: o app (workflow-action-handler, copilot log-history) pula de
-- propósito o log de stage de automação — comentário "PG triggers
-- trg_pipe_*_stage_change handle these". Esse trigger existia nas tabelas
-- legadas pipe_whatsapp/pipe_confirmacao e foi PERDIDO quando elas viraram
-- VIEWS sobre pipeline_entries (migração realtime). Resultado: movimentações
-- feitas por automação/workflow/copilot sumiram da timeline do lead.
--
-- Fix: trigger em pipeline_entries (fonte única — views system + sync de custom
-- escrevem nela). Loga SÓ moves de automação (auth.uid() IS NULL = service_role:
-- workflow/cron/copilot). Moves MANUAIS (user JWT → auth.uid setado) continuam
-- logados pelo frontend (logAction) → trigger pula → zero duplicação.
-- À prova de exceção: NUNCA bloqueia a movimentação.

CREATE OR REPLACE FUNCTION public.fn_log_pipeline_stage_change_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_slug       text;
  v_type       text;
  v_pipe_name  text;
  v_stage_name text;
BEGIN
  -- Só transição real de etapa.
  IF NEW.stage_key IS NOT DISTINCT FROM OLD.stage_key THEN
    RETURN NEW;
  END IF;

  -- Moves manuais (via user JWT) já têm log do frontend → não duplicar.
  -- Logamos apenas o que vem de service_role (automação/workflow/copilot/cron).
  IF auth.uid() IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve funil + nome de exibição da etapa (best-effort).
  SELECT slug, type, name INTO v_slug, v_type, v_pipe_name
  FROM pipelines WHERE id = NEW.pipeline_id;

  IF v_type = 'custom' THEN
    SELECT name INTO v_stage_name FROM custom_pipeline_stages
     WHERE pipeline_id = NEW.pipeline_id AND stage_key = NEW.stage_key LIMIT 1;
  ELSE
    SELECT name INTO v_stage_name FROM pipeline_stages
     WHERE organization_id = NEW.organization_id
       AND pipeline_type = v_slug AND stage_key = NEW.stage_key LIMIT 1;
  END IF;

  INSERT INTO lead_history (
    lead_id, organization_id, action, description, source, created_by,
    metadata, entity_type, entity_id
  ) VALUES (
    NEW.lead_id,
    NEW.organization_id,
    'stage_changed',
    'Etapa alterada para "' || COALESCE(v_stage_name, NEW.stage_key)
      || '" no funil ' || COALESCE(v_pipe_name, COALESCE(v_slug, 'pipeline')) || ' (automação)',
    'automation',
    NULL,
    jsonb_build_object(
      'pipeline_id', NEW.pipeline_id,
      'pipe_slug', v_slug,
      'to_stage', NEW.stage_key,
      'from_stage', OLD.stage_key,
      'via', 'pipeline_entries_trigger'
    ),
    'lead',
    NEW.lead_id
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Logging nunca pode bloquear a movimentação do lead.
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_log_pipeline_stage_change_history ON public.pipeline_entries;
CREATE TRIGGER trg_log_pipeline_stage_change_history
AFTER UPDATE OF stage_key ON public.pipeline_entries
FOR EACH ROW
WHEN (OLD.stage_key IS DISTINCT FROM NEW.stage_key)
EXECUTE FUNCTION public.fn_log_pipeline_stage_change_history();
