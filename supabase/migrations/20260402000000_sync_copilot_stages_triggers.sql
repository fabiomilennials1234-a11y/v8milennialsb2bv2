-- ============================================
-- SINCRONIZAÇÃO COPILOT ↔ PIPELINE STAGES
-- ============================================
-- Triggers para manter copilots sincronizados quando etapas são criadas/removidas.
-- - Nova etapa → adiciona ao active_stages dos copilots + cria kanban rule genérica
-- - Etapa desativada/removida → limpa active_stages, move_rules e kanban rules
-- - Validação de move_rules contra etapas existentes

-- =====================================================
-- 1. ADICIONAR COLUNA needs_review EM KANBAN RULES
-- =====================================================

ALTER TABLE public.copilot_agent_kanban_rules
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT false;

COMMENT ON COLUMN public.copilot_agent_kanban_rules.needs_review
  IS 'Indica que a regra foi auto-gerada e precisa de revisão pelo usuário';

-- =====================================================
-- 2. FUNÇÃO: LIMPAR REFERÊNCIAS DE ETAPA NOS COPILOTS
-- =====================================================

CREATE OR REPLACE FUNCTION sync_copilot_on_stage_removed()
RETURNS TRIGGER AS $$
DECLARE
  agent RECORD;
  current_stages JSONB;
  stage_array JSONB;
  new_stage_array JSONB;
  current_move_rules JSONB;
  new_move_rules JSONB;
  rule JSONB;
  removed_stage_key TEXT;
  removed_pipe_type TEXT;
  removed_org_id UUID;
BEGIN
  -- Determinar os dados da etapa removida/desativada
  IF TG_OP = 'DELETE' THEN
    removed_stage_key := OLD.stage_key;
    removed_pipe_type := OLD.pipeline_type;
    removed_org_id := OLD.organization_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.is_active = false AND OLD.is_active = true THEN
    removed_stage_key := NEW.stage_key;
    removed_pipe_type := NEW.pipeline_type;
    removed_org_id := NEW.organization_id;
  ELSE
    -- Nada a fazer
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  -- Para cada copilot_agent da mesma organização que tem esse pipe ativo
  FOR agent IN
    SELECT id, active_stages, move_rules
    FROM public.copilot_agents
    WHERE organization_id = removed_org_id
      AND active_pipes ? removed_pipe_type
  LOOP
    -- 1. Remover stage_key do active_stages[pipeline_type]
    current_stages := COALESCE(agent.active_stages, '{}'::jsonb);
    stage_array := COALESCE(current_stages -> removed_pipe_type, '[]'::jsonb);

    -- Filtrar o stage_key removido do array
    new_stage_array := '[]'::jsonb;
    FOR i IN 0..jsonb_array_length(stage_array) - 1 LOOP
      IF stage_array ->> i != removed_stage_key THEN
        new_stage_array := new_stage_array || jsonb_build_array(stage_array -> i);
      END IF;
    END LOOP;

    current_stages := jsonb_set(current_stages, ARRAY[removed_pipe_type], new_stage_array);

    -- 2. Remover move_rules que referenciam essa etapa
    current_move_rules := COALESCE(agent.move_rules, '[]'::jsonb);
    new_move_rules := '[]'::jsonb;

    FOR i IN 0..jsonb_array_length(current_move_rules) - 1 LOOP
      rule := current_move_rules -> i;
      -- Manter a regra somente se NÃO referencia a etapa removida
      IF NOT (
        (rule -> 'from' ->> 'pipe' = removed_pipe_type AND rule -> 'from' ->> 'stage' = removed_stage_key)
        OR
        (rule -> 'to' ->> 'pipe' = removed_pipe_type AND rule -> 'to' ->> 'stage' = removed_stage_key)
      ) THEN
        new_move_rules := new_move_rules || jsonb_build_array(rule);
      END IF;
    END LOOP;

    -- Atualizar o agente
    UPDATE public.copilot_agents
    SET active_stages = current_stages,
        move_rules = new_move_rules,
        updated_at = NOW()
    WHERE id = agent.id;
  END LOOP;

  -- 3. Remover kanban rules que referenciam essa etapa
  DELETE FROM public.copilot_agent_kanban_rules
  WHERE stage_name = removed_stage_key
    AND pipe_type = removed_pipe_type
    AND agent_id IN (
      SELECT id FROM public.copilot_agents
      WHERE organization_id = removed_org_id
    );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 3. FUNÇÃO: ADICIONAR NOVA ETAPA AOS COPILOTS
-- =====================================================

CREATE OR REPLACE FUNCTION sync_copilot_on_stage_created()
RETURNS TRIGGER AS $$
DECLARE
  agent RECORD;
  current_stages JSONB;
  stage_array JSONB;
BEGIN
  -- Só processa se a etapa está ativa
  IF NOT NEW.is_active THEN
    RETURN NEW;
  END IF;

  -- Para cada copilot_agent da mesma organização que tem esse pipe ativo
  FOR agent IN
    SELECT id, active_stages
    FROM public.copilot_agents
    WHERE organization_id = NEW.organization_id
      AND active_pipes ? NEW.pipeline_type
  LOOP
    -- 1. Adicionar stage_key ao active_stages[pipeline_type]
    current_stages := COALESCE(agent.active_stages, '{}'::jsonb);
    stage_array := COALESCE(current_stages -> NEW.pipeline_type, '[]'::jsonb);

    -- Verificar se já não existe (idempotência)
    IF NOT stage_array ? NEW.stage_key THEN
      stage_array := stage_array || to_jsonb(NEW.stage_key);
      current_stages := jsonb_set(current_stages, ARRAY[NEW.pipeline_type], stage_array);

      UPDATE public.copilot_agents
      SET active_stages = current_stages,
          updated_at = NOW()
      WHERE id = agent.id;
    END IF;

    -- 2. Criar kanban rule genérica com needs_review = true
    INSERT INTO public.copilot_agent_kanban_rules (
      agent_id,
      pipe_type,
      stage_name,
      goal,
      behavior,
      allowed_actions,
      forbidden_actions,
      needs_review
    ) VALUES (
      agent.id,
      NEW.pipeline_type,
      NEW.stage_key,
      'Definir objetivo para esta etapa',
      'Comportamento padrão do agente nesta etapa',
      '{}',
      '{}',
      true
    )
    ON CONFLICT (agent_id, pipe_type, stage_name) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 4. FUNÇÃO: VALIDAR MOVE_RULES CONTRA ETAPAS EXISTENTES
-- =====================================================

CREATE OR REPLACE FUNCTION validate_copilot_move_rules()
RETURNS TRIGGER AS $$
DECLARE
  rules JSONB;
  rule JSONB;
  org_id UUID;
  from_pipe TEXT;
  from_stage TEXT;
  to_pipe TEXT;
  to_stage TEXT;
  stage_exists BOOLEAN;
BEGIN
  rules := COALESCE(NEW.move_rules, '[]'::jsonb);
  org_id := NEW.organization_id;

  -- Verificar cada regra
  FOR i IN 0..jsonb_array_length(rules) - 1 LOOP
    rule := rules -> i;

    from_pipe := rule -> 'from' ->> 'pipe';
    from_stage := rule -> 'from' ->> 'stage';
    to_pipe := rule -> 'to' ->> 'pipe';
    to_stage := rule -> 'to' ->> 'stage';

    -- Pular regras incompletas (podem estar sendo editadas na UI)
    IF from_pipe IS NULL OR from_pipe = '' OR from_stage IS NULL OR from_stage = ''
       OR to_pipe IS NULL OR to_pipe = '' OR to_stage IS NULL OR to_stage = '' THEN
      CONTINUE;
    END IF;

    -- Verificar se a etapa de origem existe e está ativa
    SELECT EXISTS(
      SELECT 1 FROM public.pipeline_stages
      WHERE organization_id = org_id
        AND pipeline_type = from_pipe
        AND stage_key = from_stage
        AND is_active = true
    ) INTO stage_exists;

    IF NOT stage_exists THEN
      RAISE EXCEPTION 'Move rule #% referencia etapa de origem inexistente: %.%',
        i + 1, from_pipe, from_stage;
    END IF;

    -- Verificar se a etapa de destino existe e está ativa
    SELECT EXISTS(
      SELECT 1 FROM public.pipeline_stages
      WHERE organization_id = org_id
        AND pipeline_type = to_pipe
        AND stage_key = to_stage
        AND is_active = true
    ) INTO stage_exists;

    IF NOT stage_exists THEN
      RAISE EXCEPTION 'Move rule #% referencia etapa de destino inexistente: %.%',
        i + 1, to_pipe, to_stage;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 5. CRIAR TRIGGERS
-- =====================================================

-- Trigger: quando etapa é desativada (UPDATE) ou removida (DELETE)
DROP TRIGGER IF EXISTS on_pipeline_stage_removed ON public.pipeline_stages;
CREATE TRIGGER on_pipeline_stage_removed
  AFTER UPDATE OR DELETE ON public.pipeline_stages
  FOR EACH ROW
  EXECUTE FUNCTION sync_copilot_on_stage_removed();

-- Trigger: quando nova etapa é criada
DROP TRIGGER IF EXISTS on_pipeline_stage_created ON public.pipeline_stages;
CREATE TRIGGER on_pipeline_stage_created
  AFTER INSERT ON public.pipeline_stages
  FOR EACH ROW
  EXECUTE FUNCTION sync_copilot_on_stage_created();

-- Trigger: validar move_rules antes de salvar copilot
DROP TRIGGER IF EXISTS validate_copilot_move_rules_trigger ON public.copilot_agents;
CREATE TRIGGER validate_copilot_move_rules_trigger
  BEFORE INSERT OR UPDATE OF move_rules ON public.copilot_agents
  FOR EACH ROW
  WHEN (NEW.move_rules IS NOT NULL AND NEW.move_rules != '[]'::jsonb)
  EXECUTE FUNCTION validate_copilot_move_rules();
