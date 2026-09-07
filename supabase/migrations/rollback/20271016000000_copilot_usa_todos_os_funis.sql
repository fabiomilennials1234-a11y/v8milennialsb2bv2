-- ROLLBACK de 20271016000000_copilot_usa_todos_os_funis.sql
-- Restaura a sincronização legada por pipeline_type + stage_key.

DROP TRIGGER IF EXISTS cleanup_copilot_on_pipeline_deleted ON public.pipelines;
DROP FUNCTION IF EXISTS public.cleanup_copilot_on_pipeline_deleted();

CREATE OR REPLACE FUNCTION public.sync_copilot_on_stage_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_agent record;
  v_current_stages jsonb;
  v_stage_array jsonb;
BEGIN
  IF NOT NEW.is_active THEN RETURN NEW; END IF;

  FOR v_agent IN
    SELECT id, active_stages
      FROM public.copilot_agents
     WHERE organization_id = NEW.organization_id
       AND active_pipes ? NEW.pipeline_type
  LOOP
    v_current_stages := COALESCE(v_agent.active_stages, '{}'::jsonb);
    v_stage_array := COALESCE(v_current_stages -> NEW.pipeline_type, '[]'::jsonb);
    IF NOT v_stage_array ? NEW.stage_key THEN
      UPDATE public.copilot_agents
         SET active_stages = jsonb_set(
               v_current_stages,
               ARRAY[NEW.pipeline_type],
               v_stage_array || to_jsonb(NEW.stage_key)
             ),
             updated_at = now()
       WHERE id = v_agent.id;
    END IF;

    INSERT INTO public.copilot_agent_kanban_rules (
      agent_id, pipe_type, stage_name, goal, behavior,
      allowed_actions, forbidden_actions, needs_review
    ) VALUES (
      v_agent.id, NEW.pipeline_type, NEW.stage_key,
      'Definir objetivo para esta etapa',
      'Comportamento padrão do agente nesta etapa',
      '{}', '{}', true
    )
    ON CONFLICT (agent_id, pipe_type, stage_name) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_copilot_on_stage_removed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_agent record;
  v_current_stages jsonb;
  v_stage_array jsonb;
  v_new_stage_array jsonb;
  v_new_move_rules jsonb;
  v_removed_stage_key text;
  v_removed_pipe_type text;
  v_removed_org_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_removed_stage_key := OLD.stage_key;
    v_removed_pipe_type := OLD.pipeline_type;
    v_removed_org_id := OLD.organization_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.is_active = false AND OLD.is_active = true THEN
    v_removed_stage_key := NEW.stage_key;
    v_removed_pipe_type := NEW.pipeline_type;
    v_removed_org_id := NEW.organization_id;
  ELSE
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  FOR v_agent IN
    SELECT id, active_stages, move_rules
      FROM public.copilot_agents
     WHERE organization_id = v_removed_org_id
       AND active_pipes ? v_removed_pipe_type
  LOOP
    v_current_stages := COALESCE(v_agent.active_stages, '{}'::jsonb);
    v_stage_array := COALESCE(v_current_stages -> v_removed_pipe_type, '[]'::jsonb);
    SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
      INTO v_new_stage_array
      FROM jsonb_array_elements(v_stage_array) item(value)
     WHERE value #>> '{}' <> v_removed_stage_key;

    SELECT COALESCE(jsonb_agg(rule), '[]'::jsonb)
      INTO v_new_move_rules
      FROM jsonb_array_elements(COALESCE(v_agent.move_rules, '[]'::jsonb)) item(rule)
     WHERE NOT (
       (rule->'from'->>'pipe' = v_removed_pipe_type AND rule->'from'->>'stage' = v_removed_stage_key)
       OR
       (rule->'to'->>'pipe' = v_removed_pipe_type AND rule->'to'->>'stage' = v_removed_stage_key)
     );

    UPDATE public.copilot_agents
       SET active_stages = jsonb_set(v_current_stages, ARRAY[v_removed_pipe_type], v_new_stage_array),
           move_rules = v_new_move_rules,
           updated_at = now()
     WHERE id = v_agent.id;
  END LOOP;

  DELETE FROM public.copilot_agent_kanban_rules
   WHERE stage_name = v_removed_stage_key
     AND pipe_type = v_removed_pipe_type
     AND agent_id IN (
       SELECT id FROM public.copilot_agents WHERE organization_id = v_removed_org_id
     );

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

COMMENT ON FUNCTION public.sync_copilot_on_stage_created() IS NULL;
COMMENT ON FUNCTION public.sync_copilot_on_stage_removed() IS NULL;
COMMENT ON COLUMN public.copilot_agents.active_pipes IS
  'Lista de funis onde o agente está ativo: ["confirmacao", "propostas", "whatsapp", "campanha"]';
COMMENT ON COLUMN public.copilot_agent_kanban_rules.pipe_type IS
  'Tipo de pipeline: confirmacao, propostas, whatsapp, campanha';
COMMENT ON COLUMN public.copilot_agent_kanban_rules.stage_name IS
  'Nome exato do status/stage no pipeline';
