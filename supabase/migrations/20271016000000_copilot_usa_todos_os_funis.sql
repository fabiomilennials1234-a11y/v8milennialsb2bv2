-- Copilot acompanha etapas de qualquer funil pelo pipeline_id canônico.
-- Compatibilidade: active_pipes/active_stages antigos podem usar o slug.
-- Rollback: supabase/migrations/rollback/20271016000000_copilot_usa_todos_os_funis.sql

CREATE OR REPLACE FUNCTION public.sync_copilot_on_stage_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_agent record;
  v_pipeline_slug text;
  v_config_key text;
  v_current_stages jsonb;
  v_stage_array jsonb;
BEGIN
  IF NEW.is_active IS NOT TRUE OR NEW.pipeline_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.slug
    INTO v_pipeline_slug
    FROM public.pipelines p
   WHERE p.id = NEW.pipeline_id
     AND p.organization_id = NEW.organization_id;

  IF v_pipeline_slug IS NULL THEN
    RETURN NEW;
  END IF;

  FOR v_agent IN
    SELECT id, active_pipes, active_stages
      FROM public.copilot_agents
     WHERE organization_id = NEW.organization_id
       AND (active_pipes ? NEW.pipeline_id::text OR active_pipes ? v_pipeline_slug)
  LOOP
    v_current_stages := COALESCE(v_agent.active_stages, '{}'::jsonb);
    v_config_key := CASE
      WHEN v_current_stages ? NEW.pipeline_id::text THEN NEW.pipeline_id::text
      WHEN v_current_stages ? v_pipeline_slug THEN v_pipeline_slug
      WHEN v_agent.active_pipes ? NEW.pipeline_id::text THEN NEW.pipeline_id::text
      ELSE v_pipeline_slug
    END;
    v_stage_array := COALESCE(v_current_stages -> v_config_key, '[]'::jsonb);
    IF jsonb_typeof(v_stage_array) <> 'array' THEN
      v_stage_array := '[]'::jsonb;
    END IF;

    IF NOT v_stage_array ? NEW.stage_key THEN
      UPDATE public.copilot_agents
         SET active_stages = jsonb_set(
               v_current_stages,
               ARRAY[v_config_key],
               v_stage_array || jsonb_build_array(NEW.stage_key),
               true
             ),
             updated_at = now()
       WHERE id = v_agent.id;
    END IF;

    INSERT INTO public.copilot_agent_kanban_rules (
      agent_id, pipe_type, stage_name, goal, behavior,
      allowed_actions, forbidden_actions, needs_review
    ) VALUES (
      v_agent.id, NEW.pipeline_id::text, NEW.id::text,
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
  v_stage public.pipeline_stages%ROWTYPE;
  v_pipeline_slug text;
  v_agent record;
  v_key text;
  v_stages jsonb;
  v_move_rules jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_stage := OLD;
  ELSIF TG_OP = 'UPDATE' AND OLD.is_active IS TRUE AND NEW.is_active IS FALSE THEN
    v_stage := NEW;
  ELSE
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF v_stage.pipeline_id IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  SELECT p.slug INTO v_pipeline_slug
    FROM public.pipelines p
   WHERE p.id = v_stage.pipeline_id;
  v_pipeline_slug := COALESCE(v_pipeline_slug, v_stage.pipeline_type);

  FOR v_agent IN
    SELECT id, active_stages, move_rules
      FROM public.copilot_agents
     WHERE organization_id = v_stage.organization_id
  LOOP
    v_stages := COALESCE(v_agent.active_stages, '{}'::jsonb);

    FOREACH v_key IN ARRAY ARRAY[v_stage.pipeline_id::text, v_pipeline_slug]
    LOOP
      IF v_key IS NOT NULL AND v_stages ? v_key THEN
        v_stages := jsonb_set(
          v_stages,
          ARRAY[v_key],
          COALESCE((
            SELECT jsonb_agg(value)
              FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(v_stages -> v_key) = 'array'
                     THEN v_stages -> v_key ELSE '[]'::jsonb END
              ) item(value)
             WHERE value #>> '{}' NOT IN (v_stage.stage_key, v_stage.id::text)
          ), '[]'::jsonb),
          true
        );
      END IF;
    END LOOP;

    v_move_rules := COALESCE((
      SELECT jsonb_agg(rule)
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(COALESCE(v_agent.move_rules, '[]'::jsonb)) = 'array'
               THEN COALESCE(v_agent.move_rules, '[]'::jsonb) ELSE '[]'::jsonb END
        ) item(rule)
       WHERE NOT (
         (rule->'from'->>'pipe' IN (v_stage.pipeline_id::text, v_pipeline_slug)
          AND rule->'from'->>'stage' IN (v_stage.stage_key, v_stage.id::text))
         OR
         (rule->'to'->>'pipe' IN (v_stage.pipeline_id::text, v_pipeline_slug)
          AND rule->'to'->>'stage' IN (v_stage.stage_key, v_stage.id::text))
       )
    ), '[]'::jsonb);

    IF v_stages IS DISTINCT FROM COALESCE(v_agent.active_stages, '{}'::jsonb)
       OR v_move_rules IS DISTINCT FROM COALESCE(v_agent.move_rules, '[]'::jsonb) THEN
      UPDATE public.copilot_agents
         SET active_stages = v_stages,
             move_rules = v_move_rules,
             updated_at = now()
       WHERE id = v_agent.id;
    END IF;
  END LOOP;

  DELETE FROM public.copilot_agent_kanban_rules r
   WHERE r.agent_id IN (
     SELECT a.id FROM public.copilot_agents a
      WHERE a.organization_id = v_stage.organization_id
   )
     AND r.pipe_type IN (v_stage.pipeline_id::text, v_pipeline_slug)
     AND r.stage_name IN (v_stage.id::text, v_stage.stage_key);

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

-- A exclusão do funil remove referências do Copilot para seeds e funis criados
-- pela organização. O trigger roda antes da linha desaparecer.
CREATE OR REPLACE FUNCTION public.cleanup_copilot_on_pipeline_deleted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  UPDATE public.copilot_agents a
     SET active_pipes = COALESCE((
           SELECT jsonb_agg(value)
             FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(COALESCE(a.active_pipes, '[]'::jsonb)) = 'array'
                    THEN COALESCE(a.active_pipes, '[]'::jsonb) ELSE '[]'::jsonb END
             ) item(value)
            WHERE value #>> '{}' NOT IN (OLD.id::text, OLD.slug)
         ), '[]'::jsonb),
         active_stages = COALESCE(a.active_stages, '{}'::jsonb) - OLD.id::text - OLD.slug,
         updated_at = now()
   WHERE a.organization_id = OLD.organization_id
     AND (
       a.active_pipes ? OLD.id::text
       OR a.active_pipes ? OLD.slug
       OR COALESCE(a.active_stages, '{}'::jsonb) ? OLD.id::text
       OR COALESCE(a.active_stages, '{}'::jsonb) ? OLD.slug
     );

  DELETE FROM public.copilot_agent_kanban_rules r
   WHERE r.agent_id IN (
     SELECT a.id FROM public.copilot_agents a
      WHERE a.organization_id = OLD.organization_id
   )
     AND r.pipe_type IN (OLD.id::text, OLD.slug);

  UPDATE public.copilot_agent_followup_rules r
     SET filter_pipes = array_remove(array_remove(r.filter_pipes, OLD.id::text), OLD.slug),
         updated_at = now()
   WHERE r.agent_id IN (
           SELECT a.id FROM public.copilot_agents a
            WHERE a.organization_id = OLD.organization_id
         )
     AND (OLD.id::text = ANY(r.filter_pipes) OR OLD.slug = ANY(r.filter_pipes));

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS cleanup_copilot_on_pipeline_deleted ON public.pipelines;
CREATE TRIGGER cleanup_copilot_on_pipeline_deleted
BEFORE DELETE ON public.pipelines
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_copilot_on_pipeline_deleted();

REVOKE ALL ON FUNCTION public.cleanup_copilot_on_pipeline_deleted() FROM PUBLIC;

COMMENT ON FUNCTION public.sync_copilot_on_stage_created() IS
  'Sincroniza active_stages e cria kanban rule por pipeline/stage UUID para qualquer funil ativo.';
COMMENT ON FUNCTION public.sync_copilot_on_stage_removed() IS
  'Remove referências UUID/slug da etapa desativada ou excluída nas configurações do Copilot.';
COMMENT ON FUNCTION public.cleanup_copilot_on_pipeline_deleted() IS
  'Remove referências UUID/slug do funil excluído em agentes e regras de follow-up do Copilot.';
COMMENT ON COLUMN public.copilot_agents.active_pipes IS
  'Referências de funis ativos do agente. Aceita UUID canônico e slug legado durante compatibilidade.';
COMMENT ON COLUMN public.copilot_agent_kanban_rules.pipe_type IS
  'Referência do funil: pipeline UUID canônico; slug legado aceito na leitura.';
COMMENT ON COLUMN public.copilot_agent_kanban_rules.stage_name IS
  'Referência da etapa: pipeline_stages UUID canônico; stage_key legado aceito na leitura.';
