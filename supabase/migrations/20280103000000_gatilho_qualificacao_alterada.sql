-- Gatilho de automação "Qualificação alterada" (`qualification_changed`).
--
-- Antes: marcar pré-qualificação ou qualificação no lead (bronze → diamante)
-- não disparava nada. `trigger_workflow_field_changed` só observa
-- company/segment/urgency/faturamento/rating/email/phone/name, então não havia
-- como reagir ao nível dado pelo SDR (pré) ou pelo vendedor (qualificação).
-- Caso de origem: Chiquê precisa mandar `representante_qualificado` à Meta
-- quando um representante recebe nível prata ou acima.
--
-- Contrato do contexto (fire_workflow_trigger):
--   field     'pre_qualification_tier' | 'qualification_tier'
--   old_tier  nível anterior ('' quando não havia)
--   new_tier  nível novo (nunca vazio: limpar o nível não dispara)
--   stage_ids etapas (uuid em texto) em que o lead está no momento da mudança
--
-- Config do gatilho (todas opcionais; ausente ou lista vazia = qualquer):
--   fields     lista de campos acima
--   tiers      lista de níveis novos aceitos
--   stage_ids  lead precisa estar em PELO MENOS UMA dessas etapas
-- Tipo inválido em qualquer chave falha fechado (não dispara), igual a
-- `deal_created`.
--
-- O corpo de `matches_workflow_trigger_config` abaixo é o de PROD em
-- 2026-11-10 (pg_get_functiondef), mais o ramo novo. O repo estava atrás.

CREATE OR REPLACE FUNCTION public.matches_workflow_trigger_config(p_trigger_type text, p_config jsonb, p_context jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_stages jsonb;
  v_to_stage text;
  v_stage_id text;
BEGIN
  CASE p_trigger_type

  WHEN 'stage_changed' THEN
    IF COALESCE(p_config->>'pipe_type', '') != ''
       AND p_config->>'pipe_type' IS DISTINCT FROM p_context->>'pipe_type'
    THEN RETURN FALSE; END IF;

    IF COALESCE(p_config->>'pipeline_id', '') != ''
       AND p_config->>'pipeline_id' IS DISTINCT FROM p_context->>'pipeline_id'
    THEN RETURN FALSE; END IF;

    IF COALESCE(p_config->>'from_stage', '') != ''
       AND p_config->>'from_stage' IS DISTINCT FROM p_context->>'from_stage'
       AND p_config->>'from_stage' IS DISTINCT FROM p_context->>'from_stage_id'
    THEN RETURN FALSE; END IF;

    v_stages := p_config->'stages';
    v_to_stage := p_context->>'to_stage';
    v_stage_id := p_context->>'stage_id';
    IF v_stages IS NOT NULL AND jsonb_typeof(v_stages) != 'array' THEN
      RETURN FALSE;
    ELSIF v_stages IS NOT NULL AND jsonb_array_length(v_stages) > 0 THEN
      IF NOT (
        (v_to_stage IS NOT NULL AND v_stages ? v_to_stage)
        OR (v_stage_id IS NOT NULL AND v_stages ? v_stage_id)
      ) THEN RETURN FALSE; END IF;
    ELSIF COALESCE(p_config->>'to_stage', '') != ''
          AND p_config->>'to_stage' IS DISTINCT FROM v_to_stage
          AND p_config->>'to_stage' IS DISTINCT FROM v_stage_id
    THEN RETURN FALSE; END IF;

    RETURN TRUE;

  WHEN 'field_changed' THEN
    IF p_config->>'field_name' IS NOT NULL AND p_config->>'field_name' != ''
       AND p_context->>'field_name' IS NOT NULL
       AND p_config->>'field_name' != p_context->>'field_name'
    THEN RETURN FALSE; END IF;
    RETURN TRUE;

  WHEN 'qualification_changed' THEN
    -- Listas: tipo errado ou item não-texto/vazio falha fechado.
    IF EXISTS (
      SELECT 1
      FROM unnest(ARRAY['fields', 'tiers', 'stage_ids']) AS k(key)
      WHERE p_config ? k.key
        AND (
          jsonb_typeof(p_config->k.key) != 'array'
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(p_config->k.key) AS item(value)
            WHERE jsonb_typeof(item.value) != 'string'
               OR btrim(item.value #>> '{}') = ''
          )
        )
    ) THEN
      RETURN FALSE;
    END IF;

    IF jsonb_array_length(COALESCE(p_config->'fields', '[]'::jsonb)) > 0
       AND NOT (p_config->'fields' ? COALESCE(p_context->>'field', ''))
    THEN RETURN FALSE; END IF;

    IF jsonb_array_length(COALESCE(p_config->'tiers', '[]'::jsonb)) > 0
       AND NOT (p_config->'tiers' ? COALESCE(p_context->>'new_tier', ''))
    THEN RETURN FALSE; END IF;

    IF jsonb_array_length(COALESCE(p_config->'stage_ids', '[]'::jsonb)) > 0 THEN
      IF jsonb_typeof(p_context->'stage_ids') IS DISTINCT FROM 'array'
         OR NOT EXISTS (
           SELECT 1
           FROM jsonb_array_elements_text(p_config->'stage_ids') AS s(id)
           WHERE p_context->'stage_ids' ? s.id
         )
      THEN RETURN FALSE; END IF;
    END IF;

    RETURN TRUE;

  WHEN 'lead_created' THEN
    IF COALESCE(p_config->>'filter_origin', '') != '' THEN
      IF COALESCE(btrim(p_context->>'origin'), '') = ''
         OR lower(btrim(p_config->>'filter_origin')) != lower(btrim(p_context->>'origin'))
      THEN RETURN FALSE; END IF;
    END IF;

    -- Contrato canônico: UUID de pipelines para qualquer funil. Config canônica
    -- prevalece sobre o campo legado caso uma definição antiga carregue ambos.
    IF COALESCE(p_config->>'filter_pipeline_id', '') != '' THEN
      IF COALESCE(p_context->>'pipeline_id', '') = ''
         OR p_config->>'filter_pipeline_id' != p_context->>'pipeline_id'
      THEN RETURN FALSE; END IF;
    ELSIF COALESCE(p_config->>'filter_pipe', '') = ''
          AND COALESCE(p_context->>'pipeline_id', '') != '' THEN
      -- O INSERT do lead já dispara a automação genérica. A entrada no funil
      -- não deve criar uma segunda execução para o mesmo evento lógico.
      RETURN FALSE;
    END IF;

    -- Compatibilidade: pipe_whatsapp e whatsapp representam o mesmo seed.
    IF COALESCE(p_config->>'filter_pipeline_id', '') = ''
       AND COALESCE(p_config->>'filter_pipe', '') != '' THEN
      IF COALESCE(btrim(COALESCE(p_context->>'pipe', p_context->>'pipe_type')), '') = ''
         OR regexp_replace(lower(btrim(p_config->>'filter_pipe')), '^pipe_', '')
            != regexp_replace(
                 lower(btrim(COALESCE(p_context->>'pipe', p_context->>'pipe_type'))),
                 '^pipe_',
                 ''
               )
      THEN RETURN FALSE; END IF;
    END IF;

    RETURN TRUE;

  WHEN 'tag_added' THEN
    IF p_config->>'tag_name' IS NOT NULL AND p_config->>'tag_name' != ''
       AND p_context->>'tag_name' IS NOT NULL
       AND lower(p_config->>'tag_name') != lower(p_context->>'tag_name')
    THEN RETURN FALSE; END IF;
    RETURN TRUE;

  WHEN 'score_reached' THEN
    IF COALESCE((p_config->>'min_score')::int, 0) > 0
       AND COALESCE((p_context->>'score')::int, 0) < (p_config->>'min_score')::int
    THEN RETURN FALSE; END IF;
    RETURN TRUE;

  WHEN 'deal_created' THEN
    IF p_config ? 'require_lead'
       AND jsonb_typeof(p_config->'require_lead') != 'boolean'
    THEN RETURN FALSE; END IF;

    IF COALESCE((p_config->>'require_lead')::boolean, TRUE)
       AND COALESCE(p_context->>'lead_id', '') = ''
    THEN RETURN FALSE; END IF;

    IF p_config ? 'source' AND jsonb_typeof(p_config->'source') != 'string'
    THEN RETURN FALSE; END IF;

    IF COALESCE(NULLIF(p_config->>'source', ''), 'any') != 'any'
       AND p_config->>'source' IS DISTINCT FROM p_context->>'deal_source'
    THEN RETURN FALSE; END IF;

    IF p_config ? 'pipeline_ids' THEN
      IF jsonb_typeof(p_config->'pipeline_ids') != 'array' THEN
        RETURN FALSE;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_config->'pipeline_ids') AS item(value)
        WHERE jsonb_typeof(item.value) != 'string'
           OR btrim(item.value #>> '{}') = ''
      ) THEN
        RETURN FALSE;
      END IF;

      IF jsonb_array_length(p_config->'pipeline_ids') > 0 THEN
        IF COALESCE(p_context->>'pipeline_id', '') = ''
           OR NOT (p_config->'pipeline_ids' ? (p_context->>'pipeline_id'))
        THEN RETURN FALSE; END IF;
      END IF;
    END IF;

    IF p_config ? 'stage_ids' THEN
      IF jsonb_typeof(p_config->'stage_ids') != 'array' THEN
        RETURN FALSE;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_config->'stage_ids') AS item(value)
        WHERE jsonb_typeof(item.value) != 'string'
           OR btrim(item.value #>> '{}') = ''
      ) THEN
        RETURN FALSE;
      END IF;

      IF jsonb_array_length(p_config->'stage_ids') > 0 THEN
        IF NOT (p_config ? 'pipeline_ids')
           OR jsonb_array_length(p_config->'pipeline_ids') = 0
           OR COALESCE(p_context->>'stage_id', '') = ''
           OR NOT (p_config->'stage_ids' ? (p_context->>'stage_id'))
        THEN RETURN FALSE; END IF;
      END IF;
    END IF;

    IF p_config ? 'filter_owner_id'
       AND jsonb_typeof(p_config->'filter_owner_id') != 'string'
    THEN RETURN FALSE; END IF;

    IF COALESCE(p_config->>'filter_owner_id', '') != ''
       AND p_config->>'filter_owner_id' IS DISTINCT FROM p_context->>'owner_id'
    THEN RETURN FALSE; END IF;

    BEGIN
      IF p_config ? 'min_value' AND p_config->>'min_value' IS NOT NULL
         AND COALESCE((p_context->>'deal_value')::numeric, 0)
             < (p_config->>'min_value')::numeric
      THEN RETURN FALSE; END IF;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RETURN FALSE;
    END;

    RETURN TRUE;

  ELSE
    RETURN TRUE;
  END CASE;
END;
$function$;

-- Disparo. AFTER INSERT cobre lead que já nasce com nível (API / importação);
-- nesse caso ainda não há etapa, então filtro por etapa não casa — esperado.
CREATE OR REPLACE FUNCTION public.trigger_workflow_qualification_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_field text;
  v_old text;
  v_new text;
  v_stage_ids jsonb;
BEGIN
  -- Caminho quente (toda edição de nível): sai antes de qualquer leitura
  -- quando a org não tem automação desse tipo ligada.
  IF NOT EXISTS (
    SELECT 1 FROM public.workflows
    WHERE organization_id = NEW.organization_id
      AND trigger_type = 'qualification_changed'
      AND is_active = true
  ) THEN
    RETURN NEW;
  END IF;

  FOREACH v_field IN ARRAY ARRAY['pre_qualification_tier', 'qualification_tier'] LOOP
    IF TG_OP = 'INSERT' THEN
      v_old := NULL;
    ELSE
      EXECUTE format('SELECT ($1).%I::text', v_field) INTO v_old USING OLD;
    END IF;
    EXECUTE format('SELECT ($1).%I::text', v_field) INTO v_new USING NEW;

    IF v_new IS NOT NULL AND v_new IS DISTINCT FROM v_old THEN
      IF v_stage_ids IS NULL THEN
        SELECT COALESCE(jsonb_agg(DISTINCT e.stage_id::text), '[]'::jsonb)
          INTO v_stage_ids
        FROM public.pipeline_entries e
        WHERE e.lead_id = NEW.id
          AND e.stage_id IS NOT NULL;
      END IF;

      PERFORM public.fire_workflow_trigger(
        NEW.organization_id,
        'qualification_changed',
        NEW.id,
        jsonb_build_object(
          'trigger', 'qualification_changed',
          'field', v_field,
          'old_tier', COALESCE(v_old, ''),
          'new_tier', v_new,
          'stage_ids', v_stage_ids
        )
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

-- Função de trigger não é chamável por ninguém: só o próprio gatilho a executa.
REVOKE ALL ON FUNCTION public.trigger_workflow_qualification_changed() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_workflow_qualification_changed ON public.leads;
CREATE TRIGGER trg_workflow_qualification_changed
  AFTER INSERT OR UPDATE OF pre_qualification_tier, qualification_tier ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_workflow_qualification_changed();
