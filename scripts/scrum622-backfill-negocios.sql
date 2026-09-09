-- ============================================================================
-- SCRUM-622 (W2 · Funil é Funil) — backfill: UM Negócio por card custom sem
-- deal, com Procedência `backfill_funil_custom` e valor NULO.
--
-- NÃO é migration (guarda F4 da CLAUDE.md raiz: migration é só schema). Escreve
-- dado de cliente. Roda por `scripts/scrum622-backfill-negocios.mjs`, que
-- recusa prod sem escape explícito, exige `--org` e só persiste com `--commit`.
--
-- CONTRATO COM O RUNNER (idêntico ao M4, backfill-lead-negocio-m4.sql):
--   • a transação é do runner (BEGIN/COMMIT/ROLLBACK não estão aqui);
--   • `_param(org uuid NOT NULL, ord int NOT NULL)` já existe, populada por
--     bind parameter — uuid nunca é interpolado em texto SQL. No run real o
--     runner insere UMA org (rollout org a org, Milennials primeiro); no ensaio
--     as 7 orgs entram ordenadas (Milennials ord=1) e o arquivo processa todas,
--     na ordem, na mesma transação abortável;
--   • guarda que falha = RAISE EXCEPTION = ROLLBACK do runner. Sem meia-carga.
--
-- REGRAS VINCULANTES (CTO 2026-09-01, Jira SCRUM-622 + spec D2 + ADR-0030 Em.1):
--   • recorte: pipeline_entries de pipelines type='custom' com deal_id IS NULL
--     (3.690 medidos em prod 2026-09-02 pré-621; 3.691 DEPOIS da 20270908001000
--     aplicada no mesmo dia — o +1 é a linha própria que a inversão deu ao card
--     descasado dd91cd35. Basic4u 2.244, Maria Bonita 1.097, Milennials 274,
--     Chique 35, Goletric Pinheiros 32, HGE 8, Grafica Cauta 1; 0 sem lead_id,
--     0 sem stage_id, 0 sem entered_at — o recorte é dinâmico, não hardcoded);
--   • source = 'backfill_funil_custom' (exige 20270908002000 aplicada — guarda 0a);
--   • value = NULL SEMPRE (metadata.sale_value: 0 ocorrências no recorte);
--   • título SEMPRE derivado por data — fn_negocio_titulo_padrao(entered_at, tz
--     da org) → "Negócio de setembro/2026". NUNCA o nome do funil (ADR-0023 §9);
--   • critério de aceite como predicado DENTRO do INSERT (WHERE do próprio
--     comando: type='custom' + deal_id IS NULL + org do _param) e reconciliação
--     por org (guarda 2: recorte da org = 0 depois; criados = amarrados).
--
-- DESFECHO — decisão registrada: nasce espelhando a etapa ATUAL do card.
--   stage_role='won' → outcome 'won', won=true, outcome_source='backfill'
--   (1 card em prod); todo o resto nasce 'open'/won=false (3.551 open + 138
--   meeting_booked). Os 22 cards com closed_at preenchido estão TODOS em etapa
--   open (drift herdado): o Negócio nasce open e closed_at NÃO é copiado —
--   copiar inventaria 22 perdas que ninguém decidiu (memória: "perda sem
--   motivo"). NADA aqui emite sale_event: o caderno só escuta UPDATE OF outcome
--   (trg_deal_outcome_para_caderno), e isto é INSERT — guarda 3a prova.
--
-- TRIGGERS (enumerados em pg_trigger de prod 2026-09-02):
--   deals AFTER INSERT: trg_workflow_deal_created → fire_workflow_trigger. O
--     guard de chain_depth NÃO cobre carga de topo (depth 1); existe 1 workflow
--     deal_created em prod (Milennials, INATIVO hoje) e "inativo hoje" não é
--     guarda. DESLIGADO NOMINALMENTE na carga (precedente M4 1b) — guarda 3c
--     prova 0 execuções e guarda 4 prova que religou.
--   deals BEFORE INSERT: a_deals_exige_procedencia fica LIGADA de propósito —
--     é a rede que só o smoke pegou da outra vez; este arquivo informa source.
--   pipeline_entries AFTER UPDATE: trg_entry_touch_deal_activity atropelaria
--     last_activity_at com now() (o cursor viraria "agora" em 3.690 negócios
--     parados) → DESLIGADO na carga; last_activity_at vai explícito
--     (fn_deal_touch_activity respeita escrita explícita).
--   trg_sync_whatsapp_stage_to_lead: INERTE por código para funil custom
--     (sync_pipeline_entry_to_lead_pipe_whatsapp resolve slug só com
--     type='system'; pipeline_id não muda no UPDATE) — fingerprint 3d prova
--     pelo efeito mesmo assim.
--   trg_sync_deal_id_to_custom_pipe_entry (UPDATE OF deal_id): estado DEPENDE
--     de a SCRUM-621 já ter sido aplicada. Guarda 0c detecta por relkind:
--     'r' = espelho é tabela, o trigger propaga deal_id → guarda 3e exige
--     espelho preenchido; 'v' = view pós-inversão, trigger morto → a view
--     projeta pe.deal_id → guarda 3e exige leitura idêntica. Os DOIS estados.
-- ============================================================================

-- ── 0a. PRÉ-CONDIÇÃO: o CHECK aceita a Procedência nova ─────────────────────
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.deals'::regclass AND conname = 'deals_source_check';
  IF v_def IS NULL OR v_def NOT LIKE '%backfill_funil_custom%' THEN
    RAISE EXCEPTION
      'FAIL 0a: deals_source_check não aceita backfill_funil_custom — aplique 20270908002000 ANTES. Def atual: %',
      coalesce(v_def, 'AUSENTE');
  END IF;
  IF EXISTS (SELECT 1 FROM _param GROUP BY ord HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'FAIL 0a: _param com ord duplicada.';
  END IF;
  RAISE NOTICE '0a OK: CHECK estendido; % org(s) em _param.', (SELECT count(*) FROM _param);
END$$;

-- ── 0b. Orgs existem e retrato do alvo, org a org ───────────────────────────
CREATE TEMP TABLE _e622_alvo ON COMMIT DROP AS
SELECT p.org, p.ord, o.name, o.timezone,
       (SELECT count(*) FROM public.pipeline_entries pe
          JOIN public.pipelines pl ON pl.id = pe.pipeline_id AND pl.type = 'custom'
         WHERE pe.organization_id = p.org AND pe.deal_id IS NULL) AS cards_alvo,
       -- rerun de org já carregada tem de ser NO-OP limpo, não FAIL torto:
       -- o delta é medido contra o que JÁ existia com esta procedência.
       (SELECT count(*) FROM public.deals d
         WHERE d.organization_id = p.org AND d.source = 'backfill_funil_custom') AS ja_criados
FROM _param p
LEFT JOIN public.organizations o ON o.id = p.org;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM _e622_alvo ORDER BY ord LOOP
    IF r.name IS NULL THEN
      RAISE EXCEPTION 'FAIL 0b: org % não existe — uuid errado backfillaria 0 cards em silêncio.', r.org;
    END IF;
    RAISE NOTICE '0b: org % (%) — % card(s) custom sem Negócio.', r.name, r.org, r.cards_alvo;
  END LOOP;
END$$;

-- ── 0c. Estado do espelho custom (SCRUM-621 aplicada ou não) ────────────────
CREATE TEMP TABLE _e622_estado ON COMMIT DROP AS
SELECT (SELECT c.relkind FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'custom_pipe_entries') AS cpe_relkind;

DO $$
DECLARE v "char";
BEGIN
  SELECT cpe_relkind INTO v FROM _e622_estado;
  IF v = 'r' THEN
    RAISE NOTICE '0c: custom_pipe_entries é TABELA (pré-621) — sync deal_id vivo, espelho será conferido.';
  ELSIF v = 'v' THEN
    RAISE NOTICE '0c: custom_pipe_entries é VIEW (pós-621) — sync morto, view projeta a fonte.';
  ELSE
    RAISE EXCEPTION 'FAIL 0c: custom_pipe_entries em relkind inesperado (%).', coalesce(v::text, 'AUSENTE');
  END IF;
END$$;

-- ── 0d. Retrato do "antes": efeitos colaterais fecham pelo EFEITO ───────────
-- Mesma bateria do M4 0c: a classe "gatilho que escreve em outra tabela" já
-- escapou por nome duas vezes nesta feature; contagem fecha a classe inteira.
CREATE TEMP TABLE _e622_antes ON COMMIT DROP AS
SELECT (SELECT count(*) FROM public.sale_events            WHERE organization_id IN (SELECT org FROM _param)) AS sale_events,
       (SELECT count(*) FROM public.meeting_events         WHERE organization_id IN (SELECT org FROM _param)) AS meeting_events,
       (SELECT count(*) FROM public.lead_products          WHERE organization_id IN (SELECT org FROM _param)) AS lead_products,
       (SELECT count(*) FROM public.pipeline_stage_events  WHERE organization_id IN (SELECT org FROM _param)) AS pipeline_stage_events,
       (SELECT count(*) FROM public.lead_history           WHERE organization_id IN (SELECT org FROM _param)) AS lead_history,
       (SELECT count(*) FROM public.checklists             WHERE organization_id IN (SELECT org FROM _param)) AS checklists,
       (SELECT count(*) FROM public.scheduled_pipe_messages WHERE organization_id IN (SELECT org FROM _param)) AS scheduled_msgs,
       (SELECT count(*) FROM public.workflow_executions    WHERE organization_id IN (SELECT org FROM _param)) AS workflow_execs,
       -- webhook_deliveries não tem organization_id (medido no M4) → global
       (SELECT count(*) FROM public.webhook_deliveries)                                                       AS webhook_deliveries,
       (SELECT count(*) FROM public.deals WHERE organization_id IN (SELECT org FROM _param))                  AS deals_antes,
       (SELECT md5(coalesce(string_agg(l.id::text || '=' || coalesce(l.pipe_whatsapp, '<null>'), ',' ORDER BY l.id), ''))
          FROM public.leads l WHERE l.organization_id IN (SELECT org FROM _param))                            AS leads_fp;

-- ── 1. Desligar NOMINALMENTE os dois gatilhos que a carga acordaria ─────────
-- Transacional: guarda que aborta religa via ROLLBACK. Guarda 4 confere 'O'.
ALTER TABLE public.deals            DISABLE TRIGGER trg_workflow_deal_created;
ALTER TABLE public.pipeline_entries DISABLE TRIGGER trg_entry_touch_deal_activity;

-- ── 2. A escrita, ORG A ORG na ordem de _param ──────────────────────────────
-- Um comando por org (WITH novo AS INSERT … UPDATE), o MESMO shape do M4 2a/2b.
-- O critério de aceite é o WHERE do próprio INSERT: pl.type='custom' AND
-- pe.deal_id IS NULL AND pe.organization_id = org. Junta com pipeline_stages
-- por pe.stage_id (uuid, SCRUM-617 — 0 nulos no recorte): 1:1 por construção,
-- e uq_pipeline_entries_deal_id garante que card não recebe dois Negócios.
CREATE TEMP TABLE _e622_criados (org uuid, criados bigint, amarrados bigint) ON COMMIT DROP;

DO $$
DECLARE
  r          record;
  v_amarr    bigint;
  v_criados  bigint;
  v_restante bigint;
BEGIN
  FOR r IN SELECT * FROM _e622_alvo ORDER BY ord LOOP
    WITH novo AS (
      INSERT INTO public.deals (
        organization_id, title, value, currency, owner_id, source_lead_id,
        won, closed_at, outcome, outcome_at, outcome_source,
        notes, metadata, source, created_at, last_activity_at
      )
      SELECT
        pe.organization_id,
        -- Título SEMPRE derivado por data (entered_at no fuso da org) — NUNCA
        -- o nome do funil (regra vinculante; ADR-0023 §9).
        public.fn_negocio_titulo_padrao(coalesce(pe.entered_at, pe.created_at), o.timezone),
        NULL,                                   -- valor NULO, regra vinculante
        'BRL',
        pe.assigned_to,                         -- 2.662 válidos, 1.028 NULL, 0 órfãos (medido)
        pe.lead_id,
        (s.stage_role = 'won') IS TRUE,
        CASE WHEN s.stage_role = 'won' THEN pe.closed_at END,
        CASE WHEN s.stage_role = 'won' THEN 'won' ELSE 'open' END,
        CASE WHEN s.stage_role = 'won' THEN pe.closed_at END,
        CASE WHEN s.stage_role = 'won' THEN 'backfill' END,
        pe.notes,
        jsonb_build_object('backfilled_from_entry', pe.id),
        'backfill_funil_custom',
        coalesce(pe.entered_at, pe.created_at),
        coalesce(pe.stage_changed_at, pe.entered_at, pe.created_at)
      FROM public.pipeline_entries pe
      JOIN public.pipelines pl ON pl.id = pe.pipeline_id AND pl.type = 'custom'
      JOIN public.organizations o ON o.id = pe.organization_id
      LEFT JOIN public.pipeline_stages s ON s.id = pe.stage_id
      WHERE pe.deal_id IS NULL
        AND pe.organization_id = r.org
      RETURNING id, (metadata->>'backfilled_from_entry')::uuid AS entry_id
    )
    UPDATE public.pipeline_entries pe
       SET deal_id = novo.id
      FROM novo
     WHERE pe.id = novo.entry_id;
    GET DIAGNOSTICS v_amarr = ROW_COUNT;

    -- Reconciliação POR ORG, imediata (delta contra o pré-existente):
    SELECT count(*) - r.ja_criados INTO v_criados FROM public.deals
     WHERE organization_id = r.org AND source = 'backfill_funil_custom';
    IF v_criados <> r.cards_alvo OR v_amarr <> r.cards_alvo THEN
      RAISE EXCEPTION
        'FAIL 2 (org %): alvo=% criados=% amarrados=% — tinha de ser o mesmo número três vezes.',
        r.name, r.cards_alvo, v_criados, v_amarr;
    END IF;

    SELECT count(*) INTO v_restante
      FROM public.pipeline_entries pe
      JOIN public.pipelines pl ON pl.id = pe.pipeline_id AND pl.type = 'custom'
     WHERE pe.organization_id = r.org AND pe.deal_id IS NULL;
    IF v_restante <> 0 THEN
      RAISE EXCEPTION 'FAIL 2 (org %): % card(s) custom seguem sem Negócio.', r.name, v_restante;
    END IF;

    INSERT INTO _e622_criados VALUES (r.org, v_criados, v_amarr);
    RAISE NOTICE 'ORG_OK % (%): % Negócio(s) criados e amarrados; recorte zerado.',
      r.name, r.org, v_criados;
  END LOOP;
END$$;

-- ── 2z. Religar — fora de bloco condicional, como no M4 2c ──────────────────
ALTER TABLE public.deals            ENABLE TRIGGER trg_workflow_deal_created;
ALTER TABLE public.pipeline_entries ENABLE TRIGGER trg_entry_touch_deal_activity;

-- ── 3. GUARDA DEPOIS ────────────────────────────────────────────────────────
DO $$
DECLARE
  a        _e622_antes%ROWTYPE;
  v        bigint;
  v_fp     text;
  v_kind   "char";
  v_total  bigint;
BEGIN
  SELECT * INTO a FROM _e622_antes;
  SELECT cpe_relkind INTO v_kind FROM _e622_estado;
  SELECT coalesce(sum(criados), 0) INTO v_total FROM _e622_criados;

  -- 3a. Negócio nascendo (inclusive o 1 won) NÃO emite sale_event.
  SELECT count(*) INTO v FROM public.sale_events WHERE organization_id IN (SELECT org FROM _param);
  IF v <> a.sale_events THEN
    RAISE EXCEPTION 'FAIL 3a: sale_events foi de % para % — o caderno de vendas foi acordado.', a.sale_events, v;
  END IF;

  -- 3b. Nenhum outro efeito fabricado (classe fechada pelo efeito).
  SELECT count(*) INTO v FROM public.meeting_events WHERE organization_id IN (SELECT org FROM _param);
  IF v <> a.meeting_events THEN RAISE EXCEPTION 'FAIL 3b: meeting_events % → %.', a.meeting_events, v; END IF;
  SELECT count(*) INTO v FROM public.lead_products WHERE organization_id IN (SELECT org FROM _param);
  IF v <> a.lead_products THEN RAISE EXCEPTION 'FAIL 3b: lead_products % → %.', a.lead_products, v; END IF;
  SELECT count(*) INTO v FROM public.pipeline_stage_events WHERE organization_id IN (SELECT org FROM _param);
  IF v <> a.pipeline_stage_events THEN RAISE EXCEPTION 'FAIL 3b: pipeline_stage_events % → %.', a.pipeline_stage_events, v; END IF;
  SELECT count(*) INTO v FROM public.lead_history WHERE organization_id IN (SELECT org FROM _param);
  IF v <> a.lead_history THEN RAISE EXCEPTION 'FAIL 3b: lead_history % → %.', a.lead_history, v; END IF;
  SELECT count(*) INTO v FROM public.checklists WHERE organization_id IN (SELECT org FROM _param);
  IF v <> a.checklists THEN RAISE EXCEPTION 'FAIL 3b: checklists % → %.', a.checklists, v; END IF;
  SELECT count(*) INTO v FROM public.scheduled_pipe_messages WHERE organization_id IN (SELECT org FROM _param);
  IF v <> a.scheduled_msgs THEN RAISE EXCEPTION 'FAIL 3b: scheduled_pipe_messages % → % — a carga AGENDOU DISPARO.', a.scheduled_msgs, v; END IF;
  SELECT count(*) INTO v FROM public.webhook_deliveries;
  IF v <> a.webhook_deliveries THEN RAISE EXCEPTION 'FAIL 3b: webhook_deliveries (global) % → %.', a.webhook_deliveries, v; END IF;

  -- 3c. ZERO workflow disparado — razão de existir do passo 1.
  SELECT count(*) INTO v FROM public.workflow_executions WHERE organization_id IN (SELECT org FROM _param);
  IF v <> a.workflow_execs THEN
    RAISE EXCEPTION 'FAIL 3c: workflow_executions foi de % para % — deal_created disparou automação na carga.', a.workflow_execs, v;
  END IF;

  -- 3d. leads intacto byte a byte (o sync do WhatsApp é inerte para custom
  --     POR CÓDIGO; aqui a prova é pelo efeito).
  SELECT md5(coalesce(string_agg(l.id::text || '=' || coalesce(l.pipe_whatsapp, '<null>'), ',' ORDER BY l.id), ''))
    INTO v_fp FROM public.leads l WHERE l.organization_id IN (SELECT org FROM _param);
  IF v_fp IS DISTINCT FROM a.leads_fp THEN
    RAISE EXCEPTION 'FAIL 3d: leads.pipe_whatsapp MUDOU (fingerprint % → %).', a.leads_fp, v_fp;
  END IF;

  -- 3e. Espelho custom, NOS DOIS ESTADOS (armadilha 5).
  IF v_kind = 'r' THEN
    -- pré-621: trg_sync_deal_id_to_custom_pipe_entry tem de ter propagado.
    SELECT count(*) INTO v
      FROM public.custom_pipe_entries c
      JOIN public.pipeline_entries pe ON pe.id = c.id AND pe.pipeline_id = c.pipeline_id
      JOIN public.deals d ON d.id = pe.deal_id AND d.source = 'backfill_funil_custom'
     WHERE c.deal_id IS DISTINCT FROM pe.deal_id;
    IF v <> 0 THEN
      RAISE EXCEPTION 'FAIL 3e (tabela): % espelho(s) custom sem o deal_id propagado — o sync não rodou.', v;
    END IF;
  ELSE
    -- pós-621: a view projeta a fonte; divergência aqui é view quebrada.
    SELECT count(*) INTO v
      FROM public.custom_pipe_entries c
      JOIN public.pipeline_entries pe ON pe.id = c.id
      JOIN public.deals d ON d.id = pe.deal_id AND d.source = 'backfill_funil_custom'
     WHERE c.deal_id IS DISTINCT FROM pe.deal_id;
    IF v <> 0 THEN
      RAISE EXCEPTION 'FAIL 3e (view): % card(s) onde a view não projeta o deal_id da fonte.', v;
    END IF;
  END IF;

  -- 3f. Invariantes do que nasceu: valor nulo, título por data e nunca o nome
  --     do funil, procedência certa, won só onde a etapa era won, sem órfão.
  SELECT count(*) INTO v FROM public.deals
   WHERE source = 'backfill_funil_custom' AND value IS NOT NULL;
  IF v <> 0 THEN RAISE EXCEPTION 'FAIL 3f: % Negócio(s) do backfill com valor não-nulo.', v; END IF;

  SELECT count(*) INTO v FROM public.deals
   WHERE source = 'backfill_funil_custom' AND title !~ '^Negócio de [a-zç]+/[0-9]{4}$';
  IF v <> 0 THEN RAISE EXCEPTION 'FAIL 3f: % título(s) fora do formato derivado por data.', v; END IF;

  SELECT count(*) INTO v
    FROM public.deals d
    JOIN public.pipeline_entries pe ON pe.deal_id = d.id
    JOIN public.pipelines pl ON pl.id = pe.pipeline_id
   WHERE d.source = 'backfill_funil_custom' AND d.title = pl.name;
  IF v <> 0 THEN RAISE EXCEPTION 'FAIL 3f: % Negócio(s) herdaram o NOME DO FUNIL como título.', v; END IF;

  SELECT count(*) INTO v
    FROM public.deals d
    LEFT JOIN public.pipeline_entries pe ON pe.deal_id = d.id
   WHERE d.source = 'backfill_funil_custom' AND pe.id IS NULL;
  IF v <> 0 THEN RAISE EXCEPTION 'FAIL 3f: % Negócio(s) órfão(s) — criados sem card amarrado.', v; END IF;

  SELECT count(*) INTO v
    FROM public.deals d
    JOIN public.pipeline_entries pe ON pe.deal_id = d.id
    LEFT JOIN public.pipeline_stages s ON s.id = pe.stage_id
   WHERE d.source = 'backfill_funil_custom'
     AND d.won IS DISTINCT FROM ((s.stage_role = 'won') IS TRUE);
  IF v <> 0 THEN RAISE EXCEPTION 'FAIL 3f: % Negócio(s) com won divergente da etapa do card.', v; END IF;

  -- 3g. Aritmética global: deals das orgs cresceu exatamente o total criado.
  SELECT count(*) INTO v FROM public.deals WHERE organization_id IN (SELECT org FROM _param);
  IF v <> a.deals_antes + v_total THEN
    RAISE EXCEPTION 'FAIL 3g: deals foi de % para % — esperado +%.', a.deals_antes, v, v_total;
  END IF;
END$$;

-- ── 4. Gatilhos religados ('O' = origin) — desligado em silêncio é pior ─────
DO $$
DECLARE v "char";
BEGIN
  SELECT tgenabled INTO v FROM pg_trigger
   WHERE tgrelid = 'public.deals'::regclass AND tgname = 'trg_workflow_deal_created' AND NOT tgisinternal;
  IF v IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION 'FAIL 4: trg_workflow_deal_created em estado % (esperado O).', coalesce(v::text, 'AUSENTE');
  END IF;
  SELECT tgenabled INTO v FROM pg_trigger
   WHERE tgrelid = 'public.pipeline_entries'::regclass AND tgname = 'trg_entry_touch_deal_activity' AND NOT tgisinternal;
  IF v IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION 'FAIL 4: trg_entry_touch_deal_activity em estado % (esperado O).', coalesce(v::text, 'AUSENTE');
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: % Negócio(s) criados (valor nulo, título por data, procedência backfill_funil_custom); recorte zerado em todas as orgs de _param; sale_events/workflow_executions/leads intactos; gatilhos religados.',
    (SELECT coalesce(sum(criados), 0) FROM _e622_criados);
END$$;
