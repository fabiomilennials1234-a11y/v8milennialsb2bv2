BEGIN;
-- ─────────────────────────────────────────────────────────────────────────────
-- O SUJEITO DA AUTOMAÇÃO PASSA A INCLUIR O NEGÓCIO
--
-- ADR-0023 §1: "o Negócio, não o Lead, é o que se move por um Pipeline. Um Lead
-- é a identidade durável de uma pessoa e NUNCA tem uma Etapa."
--
-- O motor de automação era a última superfície que ainda contrariava isso: todo
-- gatilho, toda execução e toda ação carregam `lead_id` e mais nada. Quando a
-- regra é de funil ("mudou de etapa", "mova para Orçamento"), o motor fala da
-- PESSOA e depois adivinha de qual Negócio se tratava — `pickActiveEntry`,
-- "o aberto, senão o mais recente".
--
-- Os dois gatilhos de etapa rodam EM CIMA da entrada do funil: têm `NEW.id` e
-- `NEW.deal_id` na mão e jogavam os dois fora. Esta migration para de jogar.
--
-- ── POR QUE A CHAVE É A ENTRADA, E NÃO O NEGÓCIO ────────────────────────────
-- ADR-0023 §5: `pipeline_entries` guarda uma linha por Negócio e essa linha
-- viaja; `deals` carrega identidade e dinheiro. Medido em prod em 2026-08-25:
-- 12.021 das 46.684 entradas (26%) NÃO têm linha em `deals`, e nos cards criados
-- desde 24/08 a proporção sem Negócio é de ~97%. Chavear a automação em
-- `deals.id` a deixaria cega para a maioria do que entra no funil hoje.
-- `pipeline_entries.id` existe para 100% dos cards; `deal_id` viaja junto quando
-- existe, porque é ele que responde "quanto vale" e "de onde veio" (ADR-0030 §4).
--
-- ── ESTA MIGRATION NÃO MUDA COMPORTAMENTO ───────────────────────────────────
-- As colunas nascem nulas e NINGUÉM as lê ainda (fatia 1 de 5). O gatilho passa
-- a mandar dois campos a mais dentro de `context`; quem não os lê continua
-- vendo exatamente o mesmo payload de antes. O pior caso é uma coluna nula.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. A execução ganha o sujeito completo ──────────────────────────────────

ALTER TABLE public.workflow_executions
  ADD COLUMN IF NOT EXISTS pipeline_entry_id uuid,
  ADD COLUMN IF NOT EXISTS deal_id uuid;

-- `ON DELETE SET NULL` e não CASCADE: apagar um card não pode apagar o registro
-- de que a automação rodou. O histórico de execução é auditoria — ele responde
-- "o que o motor fez", e essa resposta não deixa de valer porque o card sumiu.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workflow_executions_pipeline_entry_id_fkey'
  ) THEN
    ALTER TABLE public.workflow_executions
      ADD CONSTRAINT workflow_executions_pipeline_entry_id_fkey
      FOREIGN KEY (pipeline_entry_id) REFERENCES public.pipeline_entries(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workflow_executions_deal_id_fkey'
  ) THEN
    ALTER TABLE public.workflow_executions
      ADD CONSTRAINT workflow_executions_deal_id_fkey
      FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.workflow_executions.pipeline_entry_id IS
  'A POSIÇÃO que originou a execução — o card que se moveu (ADR-0023 §5). Nulo quando o gatilho é da pessoa (lead_created, tag_added) ou quando a execução nasceu antes desta coluna.';
COMMENT ON COLUMN public.workflow_executions.deal_id IS
  'A IDENTIDADE do Negócio que originou a execução. Nulo quando a entrada ainda não tem linha em `deals` — 26% dos cards em 2026-08-25.';

-- Parcial: a maioria das execuções é de gatilho da pessoa e fica nula. Indexar
-- as nulas seria indexar o caso que ninguém consulta.
CREATE INDEX IF NOT EXISTS idx_workflow_executions_entry
  ON public.workflow_executions (pipeline_entry_id)
  WHERE pipeline_entry_id IS NOT NULL;

-- ── 2. O gatilho de funil SYSTEM para de jogar a entrada fora ───────────────

CREATE OR REPLACE FUNCTION "public"."trigger_workflow_pipeline_stage_changed"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
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
  WHERE pip.id = NEW.pipeline_id AND pip.type = 'system';

  IF v_pipe_type IS NULL THEN RETURN NEW; END IF;

  SELECT value INTO v_url FROM public.cron_config WHERE key = 'campaign_rule_dispatch_url';
  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';

  v_url := replace(v_url, 'campaign-rule-dispatch', 'process-workflow-executions');

  IF v_url IS NULL OR v_secret IS NULL THEN RETURN NEW; END IF;

  -- Who moved the card? auth.uid() is the authenticated user performing the
  -- UPDATE; NULL for service_role / cron / automation moves.
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
      'context', jsonb_build_object(
        'trigger', 'stage_changed',
        'pipe_type', v_pipe_type,
        'from_stage', OLD.stage_key,
        'to_stage', NEW.stage_key,
        'changed_by_user_id', v_actor_user_id,
        'changed_by_member_id', v_actor_member_id,
        -- ── O SUJEITO ──
        -- Dentro de `context`, e não como parâmetro novo de
        -- `fire_workflow_trigger`: a assinatura da RPC é chamada por outros
        -- gatilhos e mudá-la obrigaria a mexer em todos de uma vez. Aqui o
        -- campo é aditivo — quem não lê, não vê diferença.
        --
        -- Efeito colateral DESEJADO: `trigger_dedup_key` é o hash do context,
        -- então dois Negócios do mesmo Lead entrando na mesma etapa passam a
        -- gerar chaves DIFERENTES. Sem isto o segundo era engolido em silêncio.
        'pipeline_entry_id', NEW.id,
        'deal_id', NEW.deal_id,
        'pipeline_id', NEW.pipeline_id
      )
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

-- ── 3. O gatilho de funil CUSTOM, idem ──────────────────────────────────────
--
-- Ele fala por `custom_pipe_entries`, cuja linha-espelho em `pipeline_entries`
-- é mantida por `trg_sync_custom_pipe_to_entries`. O id que interessa à
-- automação é o da ENTRADA CANÔNICA (`pipeline_entries`), porque é ela que as
-- ações escrevem — por isso a resolução por (pipeline_id, lead_id) abaixo em
-- vez de mandar `NEW.id`, que é o id do espelho custom.

CREATE OR REPLACE FUNCTION "public"."trigger_workflow_custom_pipe_stage_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_entry_id UUID;
  v_deal_id UUID;
BEGIN
  -- Only fire if stage actually changed
  IF OLD.stage_id IS DISTINCT FROM NEW.stage_id THEN
    -- A entrada CANÔNICA do funil custom vive em `pipeline_entries` (o espelho é
    -- mantido por `trg_sync_custom_pipe_to_entries`). É o id dela que interessa à
    -- automação, porque é nela que as ações escrevem — `NEW.id` aqui é o id do
    -- espelho custom e não serviria de sujeito.
    --
    -- A ordenação espelha `pickActiveEntry` (aberta > mais recente) DE PROPÓSITO:
    -- enquanto o espelho custom não carregar o id canônico, este é o mesmo
    -- critério que o resto do motor usa, e divergir aqui criaria uma terceira
    -- regra de "qual negócio" — que é exatamente o problema que esta fatia fecha.
    SELECT pe.id, pe.deal_id INTO v_entry_id, v_deal_id
    FROM public.pipeline_entries pe
    WHERE pe.pipeline_id = NEW.pipeline_id
      AND pe.lead_id = NEW.lead_id
    ORDER BY (pe.closed_at IS NULL) DESC, pe.stage_changed_at DESC NULLS LAST, pe.created_at DESC
    LIMIT 1;

    PERFORM public.fire_workflow_trigger(
      NEW.organization_id,
      'stage_changed',
      NEW.lead_id,
      jsonb_build_object(
        'trigger', 'stage_changed',
        'pipeline_id', NEW.pipeline_id::text,
        'from_stage', (SELECT stage_key FROM public.custom_pipeline_stages WHERE id = OLD.stage_id LIMIT 1),
        'to_stage', (SELECT stage_key FROM public.custom_pipeline_stages WHERE id = NEW.stage_id LIMIT 1),
        'pipeline_entry_id', v_entry_id,
        'deal_id', v_deal_id
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

-- ── ASSERÇÕES ───────────────────────────────────────────────────────────────
DO $ensaio$
DECLARE
  v_entry uuid; v_org uuid; v_lead uuid; v_wf uuid; v_exec uuid; v_n int;
BEGIN
  -- 1. colunas
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='workflow_executions' AND column_name='pipeline_entry_id') THEN
    RAISE EXCEPTION 'FALHOU: coluna pipeline_entry_id ausente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='workflow_executions' AND column_name='deal_id') THEN
    RAISE EXCEPTION 'FALHOU: coluna deal_id ausente';
  END IF;

  -- 2. FKs
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='workflow_executions_pipeline_entry_id_fkey') THEN
    RAISE EXCEPTION 'FALHOU: FK de pipeline_entry_id ausente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='workflow_executions_deal_id_fkey') THEN
    RAISE EXCEPTION 'FALHOU: FK de deal_id ausente';
  END IF;

  -- 3. índice parcial
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_workflow_executions_entry') THEN
    RAISE EXCEPTION 'FALHOU: índice idx_workflow_executions_entry ausente';
  END IF;

  -- 4. os dois gatilhos passaram a mandar o sujeito
  IF (SELECT prosrc FROM pg_proc WHERE proname='trigger_workflow_pipeline_stage_changed')
       NOT LIKE '%pipeline_entry_id%' THEN
    RAISE EXCEPTION 'FALHOU: gatilho system nao manda pipeline_entry_id';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE proname='trigger_workflow_custom_pipe_stage_change')
       NOT LIKE '%pipeline_entry_id%' THEN
    RAISE EXCEPTION 'FALHOU: gatilho custom nao manda pipeline_entry_id';
  END IF;

  -- 5. o gatilho system continua mandando o que já mandava (não é regressão)
  IF (SELECT prosrc FROM pg_proc WHERE proname='trigger_workflow_pipeline_stage_changed')
       NOT LIKE '%changed_by_member_id%' THEN
    RAISE EXCEPTION 'FALHOU: gatilho system perdeu changed_by_member_id';
  END IF;

  -- 6. a coluna aceita escrita de verdade, com FK viva
  SELECT pe.id, pe.organization_id, pe.lead_id INTO v_entry, v_org, v_lead
  FROM public.pipeline_entries pe WHERE pe.deal_id IS NOT NULL AND pe.lead_id IS NOT NULL LIMIT 1;
  SELECT id INTO v_wf FROM public.workflows WHERE organization_id = v_org LIMIT 1;
  IF v_wf IS NULL THEN SELECT id INTO v_wf FROM public.workflows LIMIT 1; END IF;

  INSERT INTO public.workflow_executions (workflow_id, organization_id, lead_id, status, context, pipeline_entry_id, deal_id)
  SELECT v_wf, v_org, v_lead, 'running', '{}'::jsonb, v_entry, pe.deal_id
  FROM public.pipeline_entries pe WHERE pe.id = v_entry
  RETURNING id INTO v_exec;

  SELECT count(*) INTO v_n FROM public.workflow_executions
  WHERE id = v_exec AND pipeline_entry_id = v_entry AND deal_id IS NOT NULL;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: execucao nao gravou o sujeito (n=%)', v_n; END IF;

  -- 7. FK recusa entrada inexistente
  BEGIN
    INSERT INTO public.workflow_executions (workflow_id, organization_id, lead_id, status, context, pipeline_entry_id)
    VALUES (v_wf, v_org, v_lead, 'running', '{}'::jsonb, '00000000-0000-0000-0000-000000000000');
    RAISE EXCEPTION 'FALHOU: FK aceitou entrada inexistente';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL; -- esperado
  END;

  RAISE NOTICE 'ENSAIO OK — 7 asserções verdes';
END
$ensaio$;

ROLLBACK;
