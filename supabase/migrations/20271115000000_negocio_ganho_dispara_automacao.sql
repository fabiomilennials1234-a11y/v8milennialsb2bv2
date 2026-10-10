-- Negócio ganho/perdido dispara automação — nativamente, uma vez por transição.
--
-- ⚠ NUMERAÇÃO PROVISÓRIA. O timestamp 20271115000000 só segue o último arquivo
-- de origin/main quando este foi escrito; a numeração final é dada NA HORA DE
-- APLICAR (colisão de ledger é o normal). Renomeie este arquivo e o rollback
-- pareado (`rollback/<mesmo nome>`) juntos.
--
-- ── O defeito (medido em prod, 2026-10-09) ────────────────────────────────
-- O gatilho "Negócio ganho/perdido" (`deal_won`/`deal_lost`) nunca disparou
-- nativamente: 0 execuções fora do adaptador Riofix. Ele era DERIVADO, no TS
-- (`_shared/workflow-trigger.ts`), de `stage_changed` + papel `won`/`lost` da
-- etapa de destino — e:
--   · funil de sistema (único que passa pelo TS via HTTP) tem 0 etapas won/lost;
--   · funil custom chama `fire_workflow_trigger('stage_changed')` em SQL, sem
--     derivação nenhuma;
--   · o botão "Ganhou"/"Perdeu", a ação `win_deal`/`lose_deal` e a API gravam
--     `deals.outcome` SEM mover o card (ADR-0023 Emenda 1) — não há
--     `stage_changed` a derivar.
-- O fato é a transição de `deals.outcome`. É dali que o gatilho passa a nascer.
--
-- ── O que esta migration faz ─────────────────────────────────────────────
-- 1. `matches_workflow_trigger_config`: ramo `deal_won`/`deal_lost` com filtro
--    estrito `pipeline_ids`/`stage_ids` (mesma semântica do `deal_created`).
--    Config vazia = qualquer funil. Antes caía no `ELSE TRUE`.
-- 2. `trigger_workflow_deal_outcome()` + `trg_workflow_deal_outcome` (AFTER
--    UPDATE OF outcome em `deals`): quando `outcome` TRANSITA para won/lost,
--    chama `fire_workflow_trigger` com o contexto unificado do Negócio
--    (`{{deal_id}}`, `{{negocio_valor}}`, …). Qualquer escritor: 'ui', 'workflow',
--    'api', 'stage'. Org SEMPRE de `NEW.organization_id`.
-- 3. `trigger_workflow_pipeline_stage_changed`: a admissão HTTP deixa de reter
--    eventos por `deal_won`/`deal_lost` ativos (a derivação TS foi removida no
--    mesmo PR). Sem isto, cada movimentação de funil de sistema numa org com
--    só `deal_won` ativo chamaria a edge function à toa.
-- 4. Riofix (objetos SÓ de prod): o adaptador `riofix_deal_outcome_event`
--    disparava `deal_won` só para o Funil Mustang. Com o gatilho nativo ele
--    viraria DISPARO DUPLO (mensagem duplicada ao cliente final). A semântica
--    migra para a config do próprio workflow (`pipeline_ids`) e o adaptador sai
--    NO MESMO ATO. `private.riofix_enqueue_workflow` fica (outros usos).
--
-- ── Por que só UPDATE (e não INSERT com outcome já won/lost) ──────────────
-- Medido em prod (90 dias): os negócios que "nascem fechados" vêm de
-- `entrada_materializada` — INSERT com `outcome='open'` (`garantir_negocio_da_
-- entrada`) seguido do UPDATE de desfecho pela RPC/etapa; esse UPDATE dispara.
-- O único INSERT que grava `outcome='won'` direto é `registrar_vendas_historicas`
-- (source 'import', `metadata.historical_sale`): venda RETROATIVA. Disparar
-- "Negócio ganho" (WhatsApp ao cliente) por uma venda de meses atrás seria
-- defeito, não cobertura. O caderno (`trg_deal_outcome_para_caderno`) também
-- só olha UPDATE — mesmo recorte.
--
-- ── Por que não há disparo duplo ─────────────────────────────────────────
-- · Um UPDATE de `outcome` = uma linha = uma execução do trigger (WHEN exige
--   transição; `open → won → won` não redispara).
-- · Arrastar para a etapa `won`: `fn_capture_sale_event` grava `outcome` (1
--   disparo, source 'stage'). Ganhar pelo botão move o card para a etapa won
--   (`trg_negocio_ganho_vai_para_etapa_won`); esse movimento chega a
--   `fn_capture_sale_event`, que encontra `outcome='won'` e NÃO escreve. E o
--   `stage_changed` desse movimento não deriva mais nada (TS removido).
-- · Ordem dos AFTER em `deals` é alfabética: `trg_workflow_deal_outcome` roda
--   depois de `trg_negocio_ganho_vai_para_etapa_won` — o contexto já leva a
--   etapa final do card.
-- · Dedup de `fire_workflow_trigger` (md5 do contexto, janela 60 s): o contexto
--   carrega `outcome_at` e `from_outcome`, então ganho → perda → ganho são três
--   chaves distintas (três transições = três disparos).
--
-- ── Encadeamento ─────────────────────────────────────────────────────────
-- Quando o desfecho vem de uma ação de workflow (`outcome_source='workflow'`),
-- `deal-operations.ts` carimba `metadata.outcome_execution_id`. Ela vira a
-- execução-pai → `chain_depth` (teto 5) corta win_deal → deal_won → lose_deal…
-- A execução-pai só é aceita se for DA MESMA ORG (metadata é editável por quem
-- edita o negócio; um id de outra org não pode ser referenciado nem usado para
-- estourar a profundidade).
--
-- ── Falha nunca derruba a venda ──────────────────────────────────────────
-- O disparo roda num subbloco `EXCEPTION WHEN OTHERS → RAISE WARNING`: fechar
-- a venda é o fato; a automação é consequência.
--
-- Reaplicar é no-op (CREATE OR REPLACE, DROP … IF EXISTS, UPDATE idempotente).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ===========================================================================
-- 1 — Matcher: ramo deal_won / deal_lost
-- ===========================================================================
-- Corpo idêntico ao vivo em prod em 2026-10-09 (= 20271016001000), mais o ramo
-- `deal_won`/`deal_lost`. CREATE OR REPLACE preserva a ACL viva.
CREATE OR REPLACE FUNCTION public.matches_workflow_trigger_config(
  p_trigger_type text,
  p_config jsonb,
  p_context jsonb
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'extensions'
AS $$
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

  -- Desfecho do Negócio. Mesmo filtro de posição do `deal_created`:
  -- ausência/lista vazia = qualquer funil (inclusive negócio sem entrada);
  -- forma inválida falha fechada; etapa exige funil marcado. Espelho TS:
  -- `matchesPositionFilter` em `_shared/workflow-trigger.ts`.
  WHEN 'deal_won', 'deal_lost' THEN
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

    RETURN TRUE;

  ELSE
    RETURN TRUE;
  END CASE;
END;
$$;

COMMENT ON FUNCTION public.matches_workflow_trigger_config(text, jsonb, jsonb) IS
  'Filtra gatilhos no banco; lead_created usa pipeline_id para qualquer funil; deal_created, deal_won e deal_lost combinam funil e etapa (pipeline_ids/stage_ids).';

-- ===========================================================================
-- 2 — O gatilho: transição de deals.outcome → deal_won / deal_lost
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.trigger_workflow_deal_outcome()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tipo      text;
  v_entry     record;
  v_parent    uuid;
  v_parent_id uuid;
BEGIN
  -- Redundante com o WHEN do trigger, de propósito: a função não confia em
  -- quem a pendura.
  IF NEW.outcome NOT IN ('won', 'lost')
     OR OLD.outcome IS NOT DISTINCT FROM NEW.outcome
     OR NEW.deleted_at IS NOT NULL
     OR NEW.source_lead_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_tipo := CASE NEW.outcome WHEN 'won' THEN 'deal_won' ELSE 'deal_lost' END;

  -- Caminho quente: a esmagadora maioria das orgs não tem workflow de
  -- desfecho. Sai antes de abrir subtransação.
  IF NOT EXISTS (
    SELECT 1 FROM public.workflows w
     WHERE w.organization_id = NEW.organization_id
       AND w.trigger_type = v_tipo
       AND w.is_active = true
  ) THEN
    RETURN NULL;
  END IF;

  BEGIN
    -- O lead tem de ser desta org e estar vivo — senão o workflow mandaria
    -- mensagem a um contato apagado ou de outro tenant.
    IF NOT EXISTS (
      SELECT 1 FROM public.leads l
       WHERE l.id = NEW.source_lead_id
         AND l.organization_id = NEW.organization_id
         AND l.deleted_at IS NULL
    ) THEN
      RETURN NULL;
    END IF;

    -- Onde o negócio está AGORA. Mesma ordem do caderno
    -- (`fn_deal_outcome_para_caderno`): entrada aberta primeiro; senão a última
    -- que existiu. Negócio sem entrada dispara com posição nula.
    SELECT pe.id, pe.pipeline_id, pe.stage_id, pe.stage_key
      INTO v_entry
      FROM public.pipeline_entries pe
     WHERE pe.deal_id = NEW.id
       AND pe.organization_id = NEW.organization_id
     ORDER BY pe.closed_at NULLS FIRST, pe.entered_at DESC, pe.id
     LIMIT 1;

    -- Execução-pai (encadeamento): só quando o desfecho veio de uma ação de
    -- workflow, e só se a execução for DESTA org.
    IF NEW.outcome_source = 'workflow' THEN
      BEGIN
        v_parent := NULLIF(NEW.metadata->>'outcome_execution_id', '')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        v_parent := NULL;
      END;
      IF v_parent IS NOT NULL THEN
        SELECT we.id INTO v_parent_id
          FROM public.workflow_executions we
         WHERE we.id = v_parent
           AND we.organization_id = NEW.organization_id;
      END IF;
    END IF;

    PERFORM public.fire_workflow_trigger(
      NEW.organization_id,
      v_tipo,
      NEW.source_lead_id,
      jsonb_build_object(
        'trigger', v_tipo,
        'lead_id', NEW.source_lead_id,
        'deal_id', NEW.id,
        'negocio_id', NEW.id,
        'pipeline_entry_id', v_entry.id,
        'pipeline_id', v_entry.pipeline_id,
        'stage_id', v_entry.stage_id,
        'stage_key', v_entry.stage_key,
        'outcome', NEW.outcome,
        'from_outcome', OLD.outcome,
        'outcome_source', NEW.outcome_source,
        'outcome_at', NEW.outcome_at,
        'deal_title', NEW.title,
        'negocio_titulo', NEW.title,
        'deal_value', COALESCE(NEW.value, 0),
        'negocio_valor', COALESCE(NEW.value, 0),
        'owner_id', NEW.owner_id,
        'loss_reason', NEW.loss_reason
      ),
      v_parent_id
    );
  EXCEPTION WHEN OTHERS THEN
    -- Automação nunca derruba o fechamento da venda.
    RAISE WARNING 'trigger_workflow_deal_outcome: negocio % (%) nao disparou %: % (%)',
      NEW.id, NEW.organization_id, v_tipo, SQLERRM, SQLSTATE;
  END;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.trigger_workflow_deal_outcome() IS
  'Transição de deals.outcome para won/lost dispara deal_won/deal_lost (fire_workflow_trigger) uma vez, com o contexto do Negócio. Falha vira WARNING. Ver 20271115000000.';

-- Função de trigger não é porta de ninguém. Função nova nasce com EXECUTE
-- explícito para anon/authenticated/service_role (default privileges do
-- Supabase) — `FROM PUBLIC` não alcança. Estado desejado: só o dono.
REVOKE ALL ON FUNCTION public.trigger_workflow_deal_outcome() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trigger_workflow_deal_outcome() FROM anon;
REVOKE ALL ON FUNCTION public.trigger_workflow_deal_outcome() FROM authenticated;
REVOKE ALL ON FUNCTION public.trigger_workflow_deal_outcome() FROM service_role;

DROP TRIGGER IF EXISTS trg_workflow_deal_outcome ON public.deals;
CREATE TRIGGER trg_workflow_deal_outcome
  AFTER UPDATE OF outcome ON public.deals
  FOR EACH ROW
  WHEN (OLD.outcome IS DISTINCT FROM NEW.outcome
        AND NEW.outcome IN ('won', 'lost')
        AND NEW.deleted_at IS NULL)
  EXECUTE FUNCTION public.trigger_workflow_deal_outcome();

-- ===========================================================================
-- 3 — Admissão HTTP de stage_changed: só stage_changed
-- ===========================================================================
-- Corpo idêntico ao vivo em prod em 2026-10-09 (= 20271021000030), exceto a
-- lista de admissão. CREATE OR REPLACE preserva SECURITY DEFINER, search_path
-- e a ACL viva ({postgres, authenticated, service_role}).
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

  -- Admission uses the workflow configuration visible when the event happens.
  -- deal_won/deal_lost no longer derive from stage_changed (they fire on the
  -- deals.outcome transition, trg_workflow_deal_outcome), so only an active
  -- stage_changed workflow justifies the HTTP call.
  IF NOT EXISTS (
    SELECT 1 FROM public.workflows w
    WHERE w.organization_id = NEW.organization_id
      AND w.is_active = true
      AND w.trigger_type = 'stage_changed'
  ) THEN RETURN NEW; END IF;

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

-- ===========================================================================
-- 4 — Riofix: a semântica sai do adaptador e vai para a config do workflow
-- ===========================================================================
-- Objetos só de prod (conferidos read-only em 2026-10-09):
--   · trigger `riofix_deal_outcome_event` em `deals` → `private.riofix_deal_outcome_event()`
--     → `private.riofix_enqueue_workflow(...)`;
--   · workflow 0d60af90-3407-400f-8000-e0f59aa65068 "Ganho → Pós-vendas"
--     (deal_won, ATIVO, trigger_config {}) — o adaptador só o disparava para
--     entrada no Funil Mustang (a9a2f3cb-63fe-4ca1-a453-f27002cc4944);
--   · workflow 5ce6255d-59ed-4f22-9340-91ab688c8515 "Perdido" (deal_lost,
--     INATIVO, {}) — o adaptador o disparava para qualquer funil: config vazia
--     já é essa semântica, nada a migrar.
-- Ordem: config primeiro, adaptador depois, no MESMO ato — não existe instante
-- em que os dois caminhos estejam vivos nem em que nenhum esteja.
-- `trigger_config` E o `data.config` do nó trigger: o editor regrava
-- `trigger_config` a partir do nó (AutomacoesEditor), e só um dos dois seria
-- apagado no próximo "Salvar". Em dev/PGlite o UPDATE não pega linha: no-op.
UPDATE public.workflows w
   SET trigger_config = '{"pipeline_ids":["a9a2f3cb-63fe-4ca1-a453-f27002cc4944"]}'::jsonb,
       definition = jsonb_set(
         w.definition,
         '{nodes}',
         (SELECT COALESCE(jsonb_agg(
                   CASE WHEN n.node->>'type' = 'trigger'
                        THEN jsonb_set(n.node, '{data,config}',
                               '{"pipeline_ids":["a9a2f3cb-63fe-4ca1-a453-f27002cc4944"]}'::jsonb, true)
                        ELSE n.node
                   END ORDER BY n.ord), '[]'::jsonb)
            FROM jsonb_array_elements(w.definition->'nodes') WITH ORDINALITY AS n(node, ord))
       )
 WHERE w.id = '0d60af90-3407-400f-8000-e0f59aa65068'
   AND w.organization_id = '36971ff5-fd73-4f30-a733-04bf8c90e5b6'
   AND w.trigger_type = 'deal_won'
   AND jsonb_typeof(w.definition->'nodes') = 'array';

DROP TRIGGER IF EXISTS riofix_deal_outcome_event ON public.deals;

DO $$
BEGIN
  -- `DROP FUNCTION IF EXISTS private.x()` ainda erra quando o SCHEMA não existe
  -- em versões antigas; dev/PGlite não têm `private`.
  IF to_regprocedure('private.riofix_deal_outcome_event()') IS NOT NULL THEN
    EXECUTE 'DROP FUNCTION private.riofix_deal_outcome_event()';
  END IF;
END $$;

-- ===========================================================================
-- 5 — Guardas: a migration se recusa a concluir errada
-- ===========================================================================
DO $$
DECLARE
  v_n   integer;
  v_def text;
  v_cfg jsonb := '{"pipeline_ids":["a9a2f3cb-63fe-4ca1-a453-f27002cc4944"]}'::jsonb;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.deals'::regclass
     AND t.tgname = 'trg_workflow_deal_outcome'
     AND t.tgenabled <> 'D'
     AND NOT t.tgisinternal;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'trg_workflow_deal_outcome nao existe (ou esta desligado) em deals';
  END IF;

  IF has_function_privilege('anon', 'public.trigger_workflow_deal_outcome()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.trigger_workflow_deal_outcome()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.trigger_workflow_deal_outcome()', 'EXECUTE') THEN
    RAISE EXCEPTION 'trigger_workflow_deal_outcome ficou executavel por anon/authenticated/service_role';
  END IF;

  IF to_regprocedure('public.fire_workflow_trigger(uuid,text,uuid,jsonb,uuid)') IS NULL THEN
    RAISE EXCEPTION 'fire_workflow_trigger(uuid,text,uuid,jsonb,uuid) nao existe — o gatilho chamaria o vazio';
  END IF;

  -- Disparo duplo: o adaptador Riofix não pode sobreviver ao gatilho nativo.
  IF EXISTS (SELECT 1 FROM pg_trigger t
              WHERE t.tgrelid = 'public.deals'::regclass
                AND t.tgname = 'riofix_deal_outcome_event') THEN
    RAISE EXCEPTION 'riofix_deal_outcome_event ainda existe em deals — deal_won dispararia duas vezes';
  END IF;
  IF to_regprocedure('private.riofix_deal_outcome_event()') IS NOT NULL THEN
    RAISE EXCEPTION 'private.riofix_deal_outcome_event() ainda existe';
  END IF;

  -- Se o workflow Riofix existe (prod), a semântica "só Funil Mustang" tem de
  -- estar na config dele — nos dois lugares.
  IF EXISTS (SELECT 1 FROM public.workflows w
              WHERE w.id = '0d60af90-3407-400f-8000-e0f59aa65068'
                AND w.organization_id = '36971ff5-fd73-4f30-a733-04bf8c90e5b6'
                AND w.trigger_type = 'deal_won'
                AND (w.trigger_config IS DISTINCT FROM v_cfg
                     OR EXISTS (SELECT 1 FROM jsonb_array_elements(w.definition->'nodes') n
                                 WHERE n->>'type' = 'trigger'
                                   AND n->'data'->'config' IS DISTINCT FROM v_cfg))) THEN
    RAISE EXCEPTION 'workflow Riofix 0d60af90 sem pipeline_ids do Funil Mustang — deal_won viraria "qualquer funil"';
  END IF;

  -- Matcher: o ramo existe e se comporta (não só o texto).
  SELECT pg_get_functiondef('public.matches_workflow_trigger_config(text,jsonb,jsonb)'::regprocedure) INTO v_def;
  IF v_def NOT LIKE '%''deal_won''%' THEN
    RAISE EXCEPTION 'matches_workflow_trigger_config nao tem ramo deal_won';
  END IF;
  IF public.matches_workflow_trigger_config('deal_won', v_cfg, '{"pipeline_id":"00000000-0000-0000-0000-000000000000"}'::jsonb)
     OR NOT public.matches_workflow_trigger_config('deal_won', v_cfg, '{"pipeline_id":"a9a2f3cb-63fe-4ca1-a453-f27002cc4944"}'::jsonb)
     OR NOT public.matches_workflow_trigger_config('deal_lost', '{}'::jsonb, '{}'::jsonb)
     OR public.matches_workflow_trigger_config('deal_lost', '{"pipeline_ids":"x"}'::jsonb, '{"pipeline_id":"x"}'::jsonb) THEN
    RAISE EXCEPTION 'matches_workflow_trigger_config: filtro de funil de deal_won/deal_lost errado';
  END IF;

  -- stage_changed não admite mais por deal_*.
  SELECT pg_get_functiondef('public.trigger_workflow_pipeline_stage_changed()'::regprocedure) INTO v_def;
  IF v_def LIKE '%''deal_won''%' OR v_def LIKE '%''deal_lost''%' THEN
    RAISE EXCEPTION 'trigger_workflow_pipeline_stage_changed ainda admite por deal_won/deal_lost';
  END IF;
  IF has_function_privilege('anon', 'public.trigger_workflow_pipeline_stage_changed()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon tem EXECUTE em trigger_workflow_pipeline_stage_changed';
  END IF;
END $$;
