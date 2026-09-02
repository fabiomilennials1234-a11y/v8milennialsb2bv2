-- 20270908006000_contexto_unico_dos_gatilhos_de_workflow.sql
--
-- SCRUM-627 · Funil é funil (Wave 3, W3) — os gatilhos de workflow em
-- `pipeline_entries` (system E custom) passam a emitir um contexto ÚNICO, e a
-- lista OF dos dois cobre `stage_key, stage_id` (fecha a limitação D-g da
-- 20270906002000 para os triggers de workflow — a 20270908005000 já fez o
-- mesmo para o webhook de saída).
-- Rollback pareado: supabase/migrations/rollback/20270908006000_contexto_unico_dos_gatilhos_de_workflow.sql
--
-- ── MEDIDO EM PROD (2026-09-02, jsjsmuncfkbsbzqzqhfq) ───────────────────────
--
--   · `workflows` stage_changed: 82 ativos. Formatos de trigger_config vivos:
--       - pipe_type slug SEM prefixo ("whatsapp" 66, "propostas" 1) — legado;
--       - pipeline_id uuid (15) — funil custom;
--       - campanha_id: 0. `stages` presente em 100%, sempre com stage_key.
--     O matcher (`matchesTriggerConfig`) casa por pipeline_id OU pipe_type —
--     nenhuma config salva quebra com o contexto novo.
--   · Gatilhos hoje: trg_workflow_pipeline_stage_changed (system, http_post,
--     `AFTER UPDATE OF stage_key`) emite pipe_type+pipeline_id+entry+deal mas
--     NÃO stage_id; trg_workflow_pipeline_custom_stage_change (custom, RPC,
--     WHEN por valor sem OF) idem; trg_workflow_pipeline_custom_entry (INSERT)
--     não declara o sujeito (pipeline_entry_id) no lead_created.
--
-- ── DECISÕES ────────────────────────────────────────────────────────────────
--
--   D-1 CONTEXTO ÚNICO nos três: `pipeline_id` sempre + `pipeline_entry_id` +
--       `stage_id` + `stage_key` + `deal_id`. `from_stage`/`to_stage`
--       (stage_key) continuam — é o que as configs salvas casam — e ganham o
--       par `from_stage_id`. `pipe_type` fica como ECO LEGADO (slug, só quando
--       o funil é de sistema) até a W6; config legada de sistema casa por ele,
--       e o matcher fail-closa config com pipe_type contra contexto sem slug.
--   D-2 `AFTER UPDATE OF stage_key, stage_id` nos DOIS gatilhos de etapa:
--       OF dispara pela lista SET do statement, não pelo valor (D-g). O
--       BEFORE-mirror `trg_pe_stage_mirror` reescreve stage_key quando só
--       stage_id muda, então o WHEN por valor (stage_key IS DISTINCT FROM)
--       continua sendo o juiz — as duas colunas na lista OF só garantem que o
--       trigger seja ELEGÍVEL nos dois mundos de escritor.
--   D-3 Efeito colateral desejado (herdado da 20270827000010): o
--       trigger_dedup_key é hash do context — stage_id novo no payload muda a
--       chave uma única vez por par (workflow, lead, janela); não há dedup
--       cross-deploy a preservar porque a chave já variava por entry.
--   D-4 `master_workflow_config_scan` re-chaveia `stage_keys` por
--       `pipelines.slug` E por `pipeline_id::text` (funil real, custom
--       incluído) — antes era só `pipeline_type`, e etapa de funil custom era
--       invisível para a varredura de referência podre. `pipeline_type` de
--       linha fantasma (pipeline_id NULL) mantém a chave antiga.
--
-- metric-lint-allow: predicado p.type='system' é despacho de gatilho byte-idêntico
-- ao da 20270827000010 (mesma função, CREATE OR REPLACE) — não é métrica.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Gatilho de etapa — funil de SISTEMA (http_post → process-workflow-executions)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trigger_workflow_pipeline_stage_changed() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
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
$$;

-- D-2: OF com as duas colunas; WHEN por valor continua o juiz (o BEFORE-mirror
-- `trg_pe_stage_mirror` já reescreveu NEW.stage_key quando só stage_id mudou).
DROP TRIGGER IF EXISTS trg_workflow_pipeline_stage_changed ON public.pipeline_entries;
CREATE TRIGGER trg_workflow_pipeline_stage_changed
  AFTER UPDATE OF stage_key, stage_id ON public.pipeline_entries
  FOR EACH ROW
  WHEN (OLD.stage_key IS DISTINCT FROM NEW.stage_key)
  EXECUTE FUNCTION public.trigger_workflow_pipeline_stage_changed();

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Gatilho de etapa — funil CUSTOM (fire_workflow_trigger direto)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trigger_workflow_pipeline_custom_stage_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pipelines p
                  WHERE p.id = NEW.pipeline_id AND p.type = 'custom') THEN
    RETURN NEW;
  END IF;

  -- CONTEXTO ÚNICO (SCRUM-627, D-1): mesmo shape do gatilho de sistema, SEM
  -- `pipe_type` — funil custom não tem slug legado a ecoar, e o matcher
  -- fail-closa config legada de sistema contra contexto sem slug.
  PERFORM public.fire_workflow_trigger(
    NEW.organization_id, 'stage_changed', NEW.lead_id,
    jsonb_build_object('trigger', 'stage_changed',
                       'pipeline_id', NEW.pipeline_id::text,
                       'pipeline_entry_id', NEW.id,
                       'deal_id', NEW.deal_id,
                       'stage_id', NEW.stage_id,
                       'stage_key', NEW.stage_key,
                       'from_stage', OLD.stage_key,
                       'from_stage_id', OLD.stage_id,
                       'to_stage', NEW.stage_key));
  RETURN NEW;
END;
$$;

-- D-2: ganha a lista OF (antes disparava em QUALQUER UPDATE com WHEN por
-- valor — funcionava, mas avaliava o WHEN em todo touch de card). Com OF, só
-- statements que mencionam stage_key/stage_id chegam ao WHEN; o BEFORE-mirror
-- garante que qualquer move real mencione uma das duas.
DROP TRIGGER IF EXISTS trg_workflow_pipeline_custom_stage_change ON public.pipeline_entries;
CREATE TRIGGER trg_workflow_pipeline_custom_stage_change
  AFTER UPDATE OF stage_key, stage_id ON public.pipeline_entries
  FOR EACH ROW
  WHEN (OLD.stage_key IS DISTINCT FROM NEW.stage_key)
  EXECUTE FUNCTION public.trigger_workflow_pipeline_custom_stage_change();

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Gatilho de entrada — funil CUSTOM (INSERT) declara o sujeito
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trigger_workflow_pipeline_custom_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pipelines p
                  WHERE p.id = NEW.pipeline_id AND p.type = 'custom') THEN
    RETURN NEW;
  END IF;

  -- SCRUM-627: os dois fires passam a declarar o SUJEITO (ADR-0031 — o card
  -- recém-nascido É o negócio da execução) e o resto do contexto único.
  PERFORM public.fire_workflow_trigger(
    NEW.organization_id, 'lead_created', NEW.lead_id,
    jsonb_build_object('trigger', 'lead_created',
                       'pipeline_id', NEW.pipeline_id::text,
                       'pipeline_entry_id', NEW.id,
                       'deal_id', NEW.deal_id,
                       'stage_id', NEW.stage_id,
                       'stage_key', NEW.stage_key));

  PERFORM public.fire_workflow_trigger(
    NEW.organization_id, 'stage_changed', NEW.lead_id,
    jsonb_build_object('trigger', 'stage_changed',
                       'pipeline_id', NEW.pipeline_id::text,
                       'pipeline_entry_id', NEW.id,
                       'deal_id', NEW.deal_id,
                       'stage_id', NEW.stage_id,
                       'stage_key', NEW.stage_key,
                       'to_stage', NEW.stage_key));
  RETURN NEW;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Varredura do Master: etapas válidas POR FUNIL REAL (D-4)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.master_workflow_config_scan()
RETURNS TABLE (
  workflow_id       uuid,
  workflow_name     text,
  organization_id   uuid,
  organization_name text,
  nodes             jsonb,
  stage_keys        jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
BEGIN
  IF NOT (SELECT public.is_master_user()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  -- `stage_keys` chaveado por TRÊS formas de referência ao mesmo funil, porque
  -- os nós salvos carregam qualquer uma: `pipelines.slug` (nó legado de
  -- sistema), `pipeline_id::text` (nó novo, qualquer funil) e `pipeline_type`
  -- (linha fantasma sem pipeline_id — resolução antiga preservada). O contrato
  -- (`findStageIssues`) procura pela ref do nó; chave ausente = não valida,
  -- mesma permissividade do executor.
  WITH etapas AS (
    SELECT y.org, jsonb_object_agg(y.chave, y.chaves) AS por_pipe
    FROM (
      SELECT x.org, x.chave, jsonb_agg(DISTINCT x.sk) AS chaves
      FROM (
        SELECT ps.organization_id AS org,
               COALESCE(p.slug, ps.pipeline_type) AS chave,
               ps.stage_key AS sk
        FROM public.pipeline_stages ps
        LEFT JOIN public.pipelines p ON p.id = ps.pipeline_id
        WHERE ps.is_active
        UNION ALL
        SELECT ps.organization_id, ps.pipeline_id::text, ps.stage_key
        FROM public.pipeline_stages ps
        WHERE ps.is_active AND ps.pipeline_id IS NOT NULL
      ) x
      WHERE x.chave IS NOT NULL
      GROUP BY x.org, x.chave
    ) y
    GROUP BY y.org
  )
  SELECT w.id,
         w.name::text,
         w.organization_id,
         o.name::text,
         COALESCE(w.definition -> 'nodes', '[]'::jsonb),
         COALESCE(e.por_pipe, '{}'::jsonb)
  FROM public.workflows w
  JOIN public.organizations o ON o.id = w.organization_id
  LEFT JOIN etapas e ON e.org = w.organization_id
  WHERE w.is_active
  ORDER BY o.name, w.name;
END $$;

REVOKE ALL ON FUNCTION public.master_workflow_config_scan() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_workflow_config_scan() TO authenticated;

COMMENT ON FUNCTION public.master_workflow_config_scan() IS
  'Matéria-prima da varredura de config de workflow: nós dos workflows ATIVOS + etapas '
  'válidas por funil (chaveadas por slug, por pipeline_id e por pipeline_type fantasma — '
  'SCRUM-627). O veredito é do contrato em src/contracts/workflows/node-requirements.ts.';

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Matcher SQL espelha o matcher TS (fire_workflow_trigger usa este)
-- ════════════════════════════════════════════════════════════════════════════
--
-- `fire_workflow_trigger` decide o INSERT da execução por
-- `matches_workflow_trigger_config` — o caminho custom casa AQUI, não no TS.
-- O ramo stage_changed ganha as duas regras do SCRUM-627, espelhando
-- `matchesTriggerConfig` (_shared/workflow-trigger.ts):
--   · fail-closed: config com pipe_type (funil de sistema, legado) NÃO casa
--     com contexto sem pipe_type mas com pipeline_id (move em funil custom).
--     Antes o filtro simplesmente não se aplicava e o workflow disparava para
--     o funil errado, em silêncio;
--   · stages/to_stage/from_stage aceitam o ID da etapa (contexto novo manda
--     stage_id/from_stage_id) além da stage_key.
-- Demais ramos byte-idênticos ao que roda em prod (conferido por
-- pg_get_functiondef, 2026-09-02).

CREATE OR REPLACE FUNCTION public.matches_workflow_trigger_config(p_trigger_type text, p_config jsonb, p_context jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_stages JSONB;
  v_to_stage TEXT;
  v_stage_id TEXT;
BEGIN
  CASE p_trigger_type

  WHEN 'stage_changed' THEN
    IF p_config->>'pipe_type' IS NOT NULL AND p_config->>'pipe_type' != '' THEN
      IF p_context->>'pipe_type' IS NOT NULL AND p_context->>'pipe_type' != '' THEN
        IF p_config->>'pipe_type' != p_context->>'pipe_type' THEN RETURN FALSE; END IF;
      ELSIF p_context->>'pipeline_id' IS NOT NULL AND p_context->>'pipeline_id' != '' THEN
        -- SCRUM-627: config legada de sistema × contexto de funil sem slug — fail-closed.
        RETURN FALSE;
      END IF;
    END IF;

    IF p_config->>'pipeline_id' IS NOT NULL AND p_config->>'pipeline_id' != ''
       AND p_context->>'pipeline_id' IS NOT NULL
       AND p_config->>'pipeline_id' != p_context->>'pipeline_id'
    THEN RETURN FALSE; END IF;

    IF p_config->>'from_stage' IS NOT NULL AND p_config->>'from_stage' != ''
       AND p_context->>'from_stage' IS NOT NULL
       AND p_config->>'from_stage' != p_context->>'from_stage'
       AND p_config->>'from_stage' IS DISTINCT FROM p_context->>'from_stage_id'
    THEN RETURN FALSE; END IF;

    v_stages := p_config->'stages';
    v_to_stage := p_context->>'to_stage';
    v_stage_id := p_context->>'stage_id';
    IF v_stages IS NOT NULL AND jsonb_array_length(v_stages) > 0 AND v_to_stage IS NOT NULL THEN
      IF NOT (v_stages ? v_to_stage OR (v_stage_id IS NOT NULL AND v_stages ? v_stage_id))
      THEN RETURN FALSE; END IF;
    ELSIF p_config->>'to_stage' IS NOT NULL AND p_config->>'to_stage' != ''
          AND v_to_stage IS NOT NULL
          AND p_config->>'to_stage' != v_to_stage
          AND p_config->>'to_stage' IS DISTINCT FROM v_stage_id
    THEN RETURN FALSE; END IF;

    RETURN TRUE;

  WHEN 'field_changed' THEN
    IF p_config->>'field_name' IS NOT NULL AND p_config->>'field_name' != ''
       AND p_context->>'field_name' IS NOT NULL
       AND p_config->>'field_name' != p_context->>'field_name'
    THEN RETURN FALSE; END IF;
    RETURN TRUE;

  WHEN 'lead_created' THEN
    IF p_config->>'filter_origin' IS NOT NULL AND p_config->>'filter_origin' != ''
       AND p_context->>'origin' IS NOT NULL
       AND p_config->>'filter_origin' != p_context->>'origin'
    THEN RETURN FALSE; END IF;

    IF p_config->>'filter_pipe' IS NOT NULL AND p_config->>'filter_pipe' != ''
       AND COALESCE(p_context->>'pipe', p_context->>'pipe_type') IS NOT NULL
       AND p_config->>'filter_pipe' != COALESCE(p_context->>'pipe', p_context->>'pipe_type')
    THEN RETURN FALSE; END IF;

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

  ELSE
    RETURN TRUE;
  END CASE;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Asserções
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_of_system int;
  v_of_custom int;
BEGIN
  -- As listas OF dos dois gatilhos têm que conter stage_key E stage_id.
  SELECT array_length(t.tgattr::int2[], 1) INTO v_of_system
  FROM pg_trigger t
  WHERE t.tgname = 'trg_workflow_pipeline_stage_changed'
    AND t.tgrelid = 'public.pipeline_entries'::regclass;
  SELECT array_length(t.tgattr::int2[], 1) INTO v_of_custom
  FROM pg_trigger t
  WHERE t.tgname = 'trg_workflow_pipeline_custom_stage_change'
    AND t.tgrelid = 'public.pipeline_entries'::regclass;

  IF COALESCE(v_of_system, 0) <> 2 OR COALESCE(v_of_custom, 0) <> 2 THEN
    RAISE EXCEPTION 'SCRUM627: lista OF dos gatilhos de workflow não tem 2 colunas (system=%, custom=%)',
      v_of_system, v_of_custom;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_workflow_pipeline_custom_entry'
                   AND tgrelid = 'public.pipeline_entries'::regclass) THEN
    RAISE EXCEPTION 'SCRUM627: trg_workflow_pipeline_custom_entry sumiu';
  END IF;
END $$;
