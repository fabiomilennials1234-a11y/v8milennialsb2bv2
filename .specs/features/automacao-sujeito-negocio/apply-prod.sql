-- APPLY EM PRODUÇÃO — fatias 1 a 5 do sujeito da automação.
-- Ensaiado com ROLLBACK antes (ensaio-f1.sql / ensaio-f4.sql), com controle
-- positivo. Aqui vai COMMIT + ledger, numa transação só.
BEGIN;

-- ALTER TABLE pega ACCESS EXCLUSIVE; sem teto, a transação ENFILEIRA gravação
-- de produção enquanto espera. 3s aborta limpo e a gente tenta de novo.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

-- Pré-condição: se prod já tiver o que vamos criar, é sinal de que alguém
-- aplicou por outro caminho — parar antes de escrever, não depois.
DO $pre$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='workflow_executions' AND column_name='pipeline_entry_id') THEN
    RAISE EXCEPTION 'ABORTA: workflow_executions.pipeline_entry_id já existe';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='checklists' AND column_name='pipeline_entry_id') THEN
    RAISE EXCEPTION 'ABORTA: checklists.pipeline_entry_id já existe';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE proname='apply_stage_checklist')
       <> '90d4a70579266ab4f90d0653b592b4cf' THEN
    RAISE EXCEPTION 'ABORTA: apply_stage_checklist mudou em prod desde o ensaio';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE proname='trigger_workflow_pipeline_stage_changed')
       <> '0d8a7b422c29c5b85bb739216253c9c7' THEN
    RAISE EXCEPTION 'ABORTA: trigger_workflow_pipeline_stage_changed mudou em prod desde o ensaio';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE proname='trigger_workflow_custom_pipe_stage_change')
       <> '6824d590073e37770beaad7490e6e46d' THEN
    RAISE EXCEPTION 'ABORTA: trigger_workflow_custom_pipe_stage_change mudou em prod desde o ensaio';
  END IF;
END
$pre$;

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
-- ─────────────────────────────────────────────────────────────────────────────
-- CHECKLIST PASSA A SER DO NEGÓCIO (fatia 4)
--
-- Decisão do CTO, 2026-08-25: "DO NEGÓCIO."
--
-- ── O QUE ESTAVA ERRADO ─────────────────────────────────────────────────────
-- `checklists` tem `lead_id` e mais nada. O gatilho de etapa
-- (`apply_stage_checklist`) roda EM CIMA da entrada do funil — sabe qual card
-- mudou — e ainda assim gravava no lead, com
-- `ON CONFLICT (lead_id, source_template_id) DO NOTHING`.
--
-- Consequência, medida em prod (2026-08-25): 146 dos 759 checklists aplicados
-- por template (19%) estão em leads com 2+ Negócios. Nesses, o SEGUNDO negócio
-- a passar pela etapa não recebe checklist nenhum, e o item que o vendedor
-- marca num negócio aparece marcado no outro — é o mesmo registro.
--
-- ── A REGRA ─────────────────────────────────────────────────────────────────
-- Herança com origem: nasce DO NEGÓCIO quando o evento que o criou foi de
-- funil; nasce DA PESSOA quando o evento foi da pessoa (tag, cadastro) ou
-- quando alguém aplicou pela ficha do lead.
--
-- `pipeline_entry_id` NULO = é da pessoa, vale para todos os negócios dela. É
-- por isso que a coluna é nullable e não há backfill: os 1.338 checklists que
-- existem hoje foram aplicados sem negócio declarado, e dizer que pertencem a
-- um deles seria inventar um fato. Eles continuam valendo para todos.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.checklists
  ADD COLUMN IF NOT EXISTS pipeline_entry_id uuid,
  ADD COLUMN IF NOT EXISTS deal_id uuid;

-- `ON DELETE CASCADE` aqui, e não SET NULL: um checklist de negócio que perde o
-- negócio não vira "checklist da pessoa" — isso o promoveria a valer para todos
-- os outros negócios do lead, que é justamente o defeito que esta migration
-- fecha. Sem o card, ele não tem mais assunto.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checklists_pipeline_entry_id_fkey') THEN
    ALTER TABLE public.checklists
      ADD CONSTRAINT checklists_pipeline_entry_id_fkey
      FOREIGN KEY (pipeline_entry_id) REFERENCES public.pipeline_entries(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checklists_deal_id_fkey') THEN
    ALTER TABLE public.checklists
      ADD CONSTRAINT checklists_deal_id_fkey
      FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.checklists.pipeline_entry_id IS
  'O Negócio dono do checklist (ADR-0023 §1). NULO = checklist da PESSOA, vale para todos os negócios dela — é o caso dos 1.338 aplicados antes desta coluna.';
COMMENT ON COLUMN public.checklists.deal_id IS
  'Identidade do Negócio, quando a entrada tem linha em `deals`. Redundante com `pipeline_entry_id` de propósito: responde por dinheiro e procedência sem um join.';

CREATE INDEX IF NOT EXISTS idx_checklists_pipeline_entry
  ON public.checklists (pipeline_entry_id)
  WHERE pipeline_entry_id IS NOT NULL;

-- ── A IDEMPOTÊNCIA MUDA DE CHAVE JUNTO ──────────────────────────────────────
--
-- Sem isto o conserto não conserta: `uniq_checklists_lead_source` proíbe o
-- MESMO template duas vezes no mesmo lead, e é ele que faz o segundo negócio
-- sair sem checklist. As duas regras passam a conviver:
--
--   · escopo NEGÓCIO  → único por (negócio, template)
--   · escopo PESSOA   → único por (lead, template), SÓ entre os sem negócio
--
-- O `WHERE pipeline_entry_id IS NULL` no segundo é a parte que não pode faltar.

DROP INDEX IF EXISTS public.uniq_checklists_lead_source;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_checklists_lead_source
  ON public.checklists (lead_id, source_template_id)
  WHERE source_template_id IS NOT NULL
    AND lead_id IS NOT NULL
    AND pipeline_entry_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_checklists_entry_source
  ON public.checklists (pipeline_entry_id, source_template_id)
  WHERE source_template_id IS NOT NULL
    AND pipeline_entry_id IS NOT NULL;

-- ── O GATILHO DE ETAPA PASSA A CARIMBAR O NEGÓCIO ───────────────────────────

CREATE OR REPLACE FUNCTION "public"."apply_stage_checklist"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_template_id uuid;
  v_stage_org_id uuid;
  v_new_checklist_id uuid;
  v_entry_id uuid;
  v_deal_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'pipeline_entries' THEN
      IF NEW.stage_key IS NOT DISTINCT FROM OLD.stage_key THEN
        RETURN NEW;
      END IF;
    END IF;
    IF TG_TABLE_NAME = 'custom_pipe_entries' THEN
      IF NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'pipeline_entries' THEN
    SELECT ps.checklist_template_id, ps.organization_id
      INTO v_template_id, v_stage_org_id
    FROM public.pipeline_stages ps
    JOIN public.pipelines p ON p.id = NEW.pipeline_id
    WHERE ps.organization_id = NEW.organization_id
      AND ps.pipeline_type = p.slug
      AND ps.stage_key = NEW.stage_key
      AND ps.is_active = true
    LIMIT 1;

    -- O card é o próprio sujeito.
    v_entry_id := NEW.id;
    v_deal_id  := NEW.deal_id;

  ELSIF TG_TABLE_NAME = 'custom_pipe_entries' THEN
    SELECT cps.checklist_template_id, cps.organization_id
      INTO v_template_id, v_stage_org_id
    FROM public.custom_pipeline_stages cps
    WHERE cps.id = NEW.stage_id
    LIMIT 1;

    -- Funil custom guarda a posição num espelho por primary key; a entrada
    -- canônica é a de `pipeline_entries`, e é ela que a automação e o card do
    -- Negócio leem. A ordenação espelha `pickActiveEntry` (aberta > mais
    -- recente) para não criar uma terceira regra de "qual negócio".
    SELECT pe.id, pe.deal_id INTO v_entry_id, v_deal_id
    FROM public.pipeline_entries pe
    WHERE pe.pipeline_id = NEW.pipeline_id
      AND pe.lead_id = NEW.lead_id
    ORDER BY (pe.closed_at IS NULL) DESC, pe.stage_changed_at DESC NULLS LAST, pe.created_at DESC
    LIMIT 1;
  END IF;

  IF v_template_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_stage_org_id IS NULL OR v_stage_org_id <> NEW.organization_id THEN
    RETURN NEW;
  END IF;

  IF NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- `lead_id` continua sendo gravado: o checklist é DO NEGÓCIO e DA PESSOA que
  -- está por trás dele. Sem o lead, a ficha do lead perderia de vista o que a
  -- automação aplicou, e as consultas por pessoa (métrica, card do Lead)
  -- precisariam de um join novo para responder o que já respondiam.
  -- ── DOIS INSERTs, E NÃO UM COM `ON CONFLICT` ESPERTO ─────────────────────
  -- O árbitro de um `ON CONFLICT` é um ÍNDICE, e os dois índices aqui são
  -- PARCIAIS com predicados opostos (`pipeline_entry_id IS NULL` contra
  -- `IS NOT NULL`). Uma linha proposta só é coberta por um deles, então não
  -- existe um alvo único que sirva aos dois casos: apontar o de negócio numa
  -- linha sem negócio não deduplica nada, e apontar o de lead numa linha COM
  -- negócio recusaria a segunda aplicação, que é justamente o que se quer
  -- permitir. O ramo explícito diz qual regra vale, em vez de deixar o
  -- planejador escolher.
  IF v_entry_id IS NOT NULL THEN
    INSERT INTO public.checklists (
      organization_id, lead_id, pipeline_entry_id, deal_id,
      source_template_id, title, description, created_by
    )
    SELECT t.organization_id, NEW.lead_id, v_entry_id, v_deal_id, t.id, t.title, t.description, NULL
    FROM public.checklists t
    WHERE t.id = v_template_id
      AND t.lead_id IS NULL
      AND t.organization_id = NEW.organization_id
    ON CONFLICT (pipeline_entry_id, source_template_id)
      WHERE source_template_id IS NOT NULL AND pipeline_entry_id IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_new_checklist_id;
  ELSE
    -- Funil custom sem entrada canônica: sem negócio a que prender, o checklist
    -- é da pessoa — e aí a regra antiga é a certa.
    INSERT INTO public.checklists (
      organization_id, lead_id, pipeline_entry_id, deal_id,
      source_template_id, title, description, created_by
    )
    SELECT t.organization_id, NEW.lead_id, NULL, NULL, t.id, t.title, t.description, NULL
    FROM public.checklists t
    WHERE t.id = v_template_id
      AND t.lead_id IS NULL
      AND t.organization_id = NEW.organization_id
    ON CONFLICT (lead_id, source_template_id)
      WHERE source_template_id IS NOT NULL AND lead_id IS NOT NULL AND pipeline_entry_id IS NULL
    DO NOTHING
    RETURNING id INTO v_new_checklist_id;
  END IF;

  IF v_new_checklist_id IS NOT NULL THEN
    INSERT INTO public.checklist_items (checklist_id, title, position, template_item_id)
    SELECT v_new_checklist_id, ci.title, ci.position, ci.id
    FROM public.checklist_items ci
    WHERE ci.checklist_id = v_template_id
    ORDER BY ci.position;
  END IF;

  RETURN NEW;
END;
$$;

-- ── ASSERÇÕES ESTRUTURAIS ───────────────────────────────────────────────────
-- Só estrutura: o COMPORTAMENTO já foi provado no ensaio com ROLLBACK, e
-- exercitá-lo aqui escreveria dado de teste em produção.
DO $pos$
DECLARE v_n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='workflow_executions' AND column_name='pipeline_entry_id') THEN
    RAISE EXCEPTION 'FALHOU: workflow_executions.pipeline_entry_id';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='workflow_executions' AND column_name='deal_id') THEN
    RAISE EXCEPTION 'FALHOU: workflow_executions.deal_id';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='checklists' AND column_name='pipeline_entry_id') THEN
    RAISE EXCEPTION 'FALHOU: checklists.pipeline_entry_id';
  END IF;

  SELECT count(*) INTO v_n FROM pg_constraint WHERE conname IN (
    'workflow_executions_pipeline_entry_id_fkey','workflow_executions_deal_id_fkey',
    'checklists_pipeline_entry_id_fkey','checklists_deal_id_fkey');
  IF v_n <> 4 THEN RAISE EXCEPTION 'FALHOU: esperava 4 FKs, achei %', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_indexes WHERE indexname IN (
    'idx_workflow_executions_entry','idx_checklists_pipeline_entry',
    'uniq_checklists_entry_source','uniq_checklists_lead_source');
  IF v_n <> 4 THEN RAISE EXCEPTION 'FALHOU: esperava 4 indices, achei %', v_n; END IF;

  IF (SELECT indexdef FROM pg_indexes WHERE indexname='uniq_checklists_lead_source')
       NOT LIKE '%pipeline_entry_id IS NULL%' THEN
    RAISE EXCEPTION 'FALHOU: indice por lead nao foi restringido aos sem negocio';
  END IF;

  IF (SELECT prosrc FROM pg_proc WHERE proname='trigger_workflow_pipeline_stage_changed')
       NOT LIKE '%pipeline_entry_id%' THEN
    RAISE EXCEPTION 'FALHOU: gatilho system nao manda o sujeito';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE proname='trigger_workflow_custom_pipe_stage_change')
       NOT LIKE '%pipeline_entry_id%' THEN
    RAISE EXCEPTION 'FALHOU: gatilho custom nao manda o sujeito';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE proname='apply_stage_checklist')
       NOT LIKE '%uniq%' AND (SELECT prosrc FROM pg_proc WHERE proname='apply_stage_checklist')
       NOT LIKE '%pipeline_entry_id%' THEN
    RAISE EXCEPTION 'FALHOU: apply_stage_checklist nao carimba o negocio';
  END IF;

  -- Nenhuma linha existente foi tocada: as colunas nascem nulas.
  SELECT count(*) INTO v_n FROM public.checklists WHERE pipeline_entry_id IS NOT NULL;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: % checklists ja nasceram com negocio', v_n; END IF;
END
$pos$;

-- ── LEDGER ──────────────────────────────────────────────────────────────────
-- Sem isto as migrations ficam fora do histórico e a próxima auditoria diz que
-- nunca subiram — e um `db push` futuro tenta reaplicá-las.
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES
  ('20270827000010', 'automacao_sujeito_negocio'),
  ('20270827000020', 'checklist_do_negocio')
ON CONFLICT (version) DO NOTHING;

COMMIT;
