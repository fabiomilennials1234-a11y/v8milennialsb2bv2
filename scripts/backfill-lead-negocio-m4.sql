-- ============================================================================
-- M4 — backfill: cada JORNADA existente vira um Negócio. UMA org por execução.
--
-- ⚠️ Reescrito 2026-08-03 contra as decisões 9 e 11 do ADR-0023. Era "cada card
-- vira um negócio, com o nome do funil por título". Agora: os funis de SISTEMA
-- do mesmo lead são UMA jornada (posicionada no ponto mais avançado), cada funil
-- CUSTOM é a sua própria, e o título é derivado — `Negócio de <mês>/<ano>`.
-- Consequência que não dá para esconder: nas jornadas com mais de um card, o
-- card de trás é APAGADO, e isso exige `--fundir-jornada` explícito. Ver o bloco
-- 1a-bis.
--
-- NÃO é migration, e isso é regra, não estilo: a CLAUDE.md raiz (guarda F4) diz
-- que migration é só schema, para que URL errada no push vire erro recuperável
-- em vez de mudança de dado. Isto escreve dado de cliente. Roda por
-- `scripts/backfill-lead-negocio-m4.mjs`, que recusa prod, exige `--org` e só
-- commita com `--commit`.
--
-- CONTRATO COM O RUNNER
--   • a transação é do runner (BEGIN/COMMIT não estão aqui);
--   • `_param(org uuid)` já existe quando este arquivo começa, criada com bind
--     parameter — o uuid nunca é interpolado em texto SQL;
--   • toda guarda usa RAISE EXCEPTION. Guarda que falha aborta a transação e o
--     runner faz ROLLBACK: não existe meia-migração.
--
-- O QUE ESTE ARQUIVO ESCREVE, E SÓ:
--   deals            +1 linha por JORNADA sem deal_id
--   pipeline_entries deal_id (uma coluna) no card eleito de cada jornada
--   pipeline_entries DELETE do card rebaixado — só com `--fundir-jornada`
--   custom_pipe_entries deal_id (pelo gatilho reverso do M7)
-- Qualquer outra escrita é bug, e cada uma tem guarda nominal abaixo.
--
-- POR QUE O `SET deal_id` NÃO É INÓCUO
-- `trg_sync_whatsapp_stage_to_lead` é AFTER INSERT OR DELETE OR UPDATE, sem lista
-- de colunas e sem WHEN. Sua única proteção é `pg_trigger_depth() > 1`, que blinda
-- o bounce (profundidade 3) e NÃO blinda este UPDATE, que é de topo. Ligado, ele
-- reescreveria `leads.pipe_whatsapp` (1.885 linhas / 34 orgs na base inteira,
-- medido em prod 2026-07-31) e nenhuma contagem perceberia. Daí o passo 1b.
--
-- O BOUNCE (reverso → custom_pipe_entries → sync → espelho) — medido no catálogo
-- da branch em 2026-07-31, não deduzido. O `ON CONFLICT (id) DO UPDATE` do
-- `sync_custom_pipe_to_entries` menciona: stage_key, assigned_to, notes,
-- stage_changed_at, updated_at, deal_id. Mencionar `stage_key` acorda SEIS
-- gatilhos `UPDATE OF stage_key` (mencionar basta; mudar não é exigido):
--
--   trg_pipeline_entries_stage_event_update  WHEN old.stage_key IS DISTINCT      → inerte
--   trg_log_pipeline_stage_change_history    WHEN old.stage_key IS DISTINCT      → inerte
--   trg_workflow_pipeline_stage_changed      WHEN old.stage_key IS DISTINCT      → inerte
--   trg_apply_stage_checklist_pipeline       IF NEW.stage_key IS NOT DISTINCT    → inerte
--   trg_pipeline_entries_dispatch            IF OLD.stage_key IS DISTINCT        → inerte
--   trg_meeting_events_capture               3 ramos, os 3 exigem mudança        → inerte
--   trg_enforce_closed_at                    NÃO compara com OLD                 → guarda 3g
--
-- Os seis primeiros são inertes **por valor**, e "o valor não muda" é exatamente
-- o que a pré-condição 0b garante. Sem 0b nenhum deles é inerte — por isso 0b
-- aborta em vez de avisar. O plano do vault só nomeava `enforce_closed_at`;
-- os outros cinco foram lidos no catálogo ao escrever este arquivo.
--
-- O QUE ESTE BACKFILL DELIBERADAMENTE NÃO FAZ
--   • não esvazia `lead_id` (a métrica de reunião pararia em silêncio);
--   • não reconcilia o drift `leads.pipe_whatsapp` × card — é decisão de produto
--     com N respostas, sai como relatório no fim;
--   • não popula `lead_products` dos ganhos (o gatilho é AFTER UPDATE e lê
--     `deal_items`, que tem 0 linhas). Se a fatia 3 precisar, é script à parte.
--
-- Plano e medições: Obsidian/…/08 — Backlog/em-progresso/lead-negocio-migrations-db.md § M4.
-- ============================================================================


-- ── 0b. PRÉ-CONDIÇÃO: fonte e espelho concordam em stage_key ────────────────
-- Se divergem, o bounce não propaga vínculo: ele MOVE o card de etapa, e aí os
-- seis gatilhos acima deixam de ser inertes de uma vez.
DO $$
DECLARE v_org uuid := (SELECT org FROM _param); v_div bigint;
BEGIN
  SELECT count(*) INTO v_div
  FROM public.custom_pipe_entries c
  JOIN public.pipeline_entries pe ON pe.id = c.id
  LEFT JOIN public.custom_pipeline_stages cs ON cs.id = c.stage_id
  WHERE c.organization_id = v_org
    AND pe.deal_id IS NULL AND pe.lead_id IS NOT NULL
    AND COALESCE(cs.stage_key, 'unknown') IS DISTINCT FROM pe.stage_key;

  IF v_div > 0 THEN
    RAISE EXCEPTION
      'FAIL: % card(s) custom com stage_key divergente entre fonte e espelho. O bounce MOVERIA o card de etapa. Reconcilie esta org antes de backfillar.', v_div;
  END IF;
  RAISE NOTICE '0b OK: fonte e espelho concordam em stage_key — o bounce sera inerte.';
END$$;

-- ── 0c. Retrato do "antes" ──────────────────────────────────────────────────
-- `leads_fp` é impressão digital, não contagem: reescrever 1.885 valores de
-- `pipe_whatsapp` não muda contagem nenhuma. As quatro últimas fecham a classe
-- "gatilho sem lista de colunas" pelo EFEITO (linha criada em outra tabela) em
-- vez de pelo nome — é a classe que já escapou duas vezes nesta feature.
CREATE TEMP TABLE _antes ON COMMIT DROP AS
SELECT (SELECT count(*) FROM public.sale_events            WHERE organization_id = (SELECT org FROM _param)) AS sale_events,
       (SELECT count(*) FROM public.meeting_events         WHERE organization_id = (SELECT org FROM _param)) AS meeting_events,
       (SELECT count(*) FROM public.lead_products          WHERE organization_id = (SELECT org FROM _param)) AS lead_products,
       (SELECT count(*) FROM public.pipeline_stage_events  WHERE organization_id = (SELECT org FROM _param)) AS pipeline_stage_events,
       (SELECT count(*) FROM public.lead_history           WHERE organization_id = (SELECT org FROM _param)) AS lead_history,
       (SELECT count(*) FROM public.checklists             WHERE organization_id = (SELECT org FROM _param)) AS checklists,
       (SELECT count(*) FROM public.scheduled_pipe_messages WHERE organization_id = (SELECT org FROM _param)) AS scheduled_msgs,
       (SELECT count(*) FROM public.workflow_executions    WHERE organization_id = (SELECT org FROM _param)) AS workflow_execs,
       -- webhook_deliveries NÃO tem organization_id (medido) → contagem global
       (SELECT count(*) FROM public.webhook_deliveries)                                                      AS webhook_deliveries,
       (SELECT count(*) FROM public.pipeline_entries
         WHERE organization_id = (SELECT org FROM _param) AND lead_id IS NULL)                               AS cards_sem_lead,
       (SELECT md5(coalesce(string_agg(l.id::text || '=' || coalesce(l.pipe_whatsapp, '<null>'), ',' ORDER BY l.id), ''))
          FROM public.leads l WHERE l.organization_id = (SELECT org FROM _param))                            AS leads_fp,
       -- Relatório, não guarda: quantos leads o gatilho reescreveria se ligado.
       (SELECT count(*) FROM public.pipeline_entries pe
          JOIN public.pipelines p ON p.id = pe.pipeline_id
          JOIN public.leads l ON l.id = pe.lead_id
         WHERE p.type = 'system' AND p.slug = 'whatsapp'
           AND pe.deal_id IS NULL AND pe.lead_id IS NOT NULL
           AND pe.organization_id = (SELECT org FROM _param)
           AND l.pipe_whatsapp IS DISTINCT FROM pe.stage_key)                                                AS wa_drift_preexistente;

-- ── 0d. Snapshot de stage_changed_at do lado do espelho, só do alvo custom ──
-- O bounce sobrescreve essa coluna com o valor da FONTE. 370 dos 16.193 pares já
-- divergem hoje em prod (12 orgs): o backfill reconcilia esses à força. Mutação
-- DECLARADA — a guarda 3f prova que foi só neles.
CREATE TEMP TABLE _snap_scat ON COMMIT DROP AS
SELECT pe.id, pe.stage_changed_at,
       (pe.stage_changed_at IS DISTINCT FROM c.stage_changed_at) AS divergia_antes
FROM public.custom_pipe_entries c
JOIN public.pipeline_entries pe ON pe.id = c.id
WHERE c.organization_id = (SELECT org FROM _param)
  AND pe.deal_id IS NULL AND pe.lead_id IS NOT NULL;

-- ── 1. A JORNADA — quem vira negócio, e qual card fica com a posição ───────
--
-- ⚠️ REESCRITO 2026-08-03 contra as decisões 9 e 11 do ADR-0023. A versão
-- anterior criava **um negócio por card** e dava a ele o **nome do funil** como
-- título. As duas coisas estão erradas agora:
--
--   • decisão 11 — um negócio por JORNADA. Os funis de SISTEMA do mesmo lead são
--     uma jornada só, posicionada no ponto mais avançado; cada funil CUSTOM é
--     uma motivação comercial à parte, e continua sendo um negócio próprio.
--     Medido em prod: um-por-card = 36.812, um-por-jornada = 35.886. A diferença
--     de 926 está concentrada nos 597 leads com card em dois funis de sistema ao
--     mesmo tempo.
--   • decisão 9 — título derivado `Negócio de <mês>/<ano>`. Herdar o nome do
--     funil foi rejeitado por não distinguir nada: produziria dezenas de
--     milhares de negócios chamados "Qualificação".
--
-- E a prova de 1:1 mudou de significado junto: ela agora é 1:1 **por jornada**.
-- Mantida como estava, ela abortaria exatamente o comportamento novo.
--
-- `_jornada` é a espinha do resto do arquivo: define o agrupamento e elege o
-- card que fica com a posição.
CREATE TEMP TABLE _jornada ON COMMIT DROP AS
WITH cand AS (
  SELECT pe.id AS entry_id, pe.lead_id, pe.organization_id, pe.pipeline_id,
         pe.stage_key, pe.assigned_to, pe.closed_at, pe.notes, pe.metadata, pe.created_at,
         p.type AS pipe_type, p.slug AS slug,
         coalesce(ps.stage_role, cs.stage_role) AS stage_role,
         -- Ordem da jornada de sistema. A escada é o próprio produto:
         -- Qualificação → Oportunidades → Orçamentos.
         CASE p.slug WHEN 'whatsapp' THEN 1 WHEN 'confirmacao' THEN 2 WHEN 'propostas' THEN 3
                     ELSE 0 END AS ordem_funil,
         coalesce(ps.position, cs.position, 0) AS ordem_etapa
  FROM public.pipeline_entries pe
  JOIN public.pipelines p ON p.id = pe.pipeline_id
  LEFT JOIN public.pipeline_stages ps
         ON ps.organization_id = pe.organization_id
        AND ps.stage_key       = pe.stage_key
        AND ps.pipeline_type   = p.slug
  LEFT JOIN public.custom_pipeline_stages cs
         ON cs.pipeline_id = pe.pipeline_id
        AND cs.stage_key   = pe.stage_key
  WHERE pe.deal_id IS NULL
    AND pe.lead_id IS NOT NULL
    AND pe.organization_id = (SELECT org FROM _param)
)
SELECT c.*,
       -- A CHAVE DA JORNADA. Sistema: o lead inteiro é uma jornada, então o
       -- pipeline_id sai da chave. Custom: cada funil é a sua própria.
       CASE WHEN c.pipe_type = 'system'
            THEN c.lead_id::text
            ELSE c.lead_id::text || '::' || c.pipeline_id::text
       END AS jornada,
       -- Quem carrega a posição: o ponto mais avançado. Desempate total
       -- (created_at, entry_id) porque duas execuções têm de eleger o MESMO card
       -- — sem isso, rodar de novo depois de um rollback escolhe outro.
       row_number() OVER (
         PARTITION BY CASE WHEN c.pipe_type = 'system'
                           THEN c.lead_id::text
                           ELSE c.lead_id::text || '::' || c.pipeline_id::text END
         ORDER BY c.ordem_funil DESC, c.ordem_etapa DESC, c.created_at DESC, c.entry_id DESC
       ) AS posto
FROM cand c;

CREATE INDEX ON _jornada (jornada);
CREATE INDEX ON _jornada (entry_id);

-- ── 1a. GUARDA ANTES: 1:1 POR JORNADA ──────────────────────────────────────
-- A versão antiga casava etapa por (organization_id, stage_key) — prefixo da
-- unique, não ela inteira — e emitia 39.164 linhas para 36.497 cards: 2.667
-- negócios fantasma, silenciosos. Cada LEFT JOIN acima cobre uma unique inteira:
--   pipeline_stages         UNIQUE (organization_id, pipeline_type, stage_key)
--   custom_pipeline_stages  UNIQUE (pipeline_id, stage_key)
-- A prova continua sendo "o join não multiplica" — só que a unidade agora é a
-- jornada, e o que se conta é: exatamente um card eleito por jornada.
DO $$
DECLARE
  v_cards bigint; v_linhas bigint; v_jornadas bigint; v_eleitos bigint; v_rebaixados bigint;
BEGIN
  SELECT count(*), count(DISTINCT entry_id), count(DISTINCT jornada),
         count(*) FILTER (WHERE posto = 1), count(*) FILTER (WHERE posto > 1)
    INTO v_linhas, v_cards, v_jornadas, v_eleitos, v_rebaixados
  FROM _jornada;

  IF v_linhas <> v_cards THEN
    RAISE EXCEPTION
      'FAIL: o join multiplica (% linhas para % cards) — % negocio(s) fantasma. Abortando ANTES de escrever.',
      v_linhas, v_cards, v_linhas - v_cards;
  END IF;

  IF v_eleitos <> v_jornadas THEN
    RAISE EXCEPTION
      'FAIL: % jornada(s) para % card(s) eleito(s) — o desempate nao elegeu exatamente um por jornada.',
      v_jornadas, v_eleitos;
  END IF;

  RAISE NOTICE
    '1 OK: % card(s) em % jornada(s) — % negocio(s) a criar, % card(s) rebaixado(s) (a menos que a versao um-por-card).',
    v_cards, v_jornadas, v_eleitos, v_rebaixados;
END$$;

-- ── 1a-bis. O QUE FAZER COM O CARD REBAIXADO ───────────────────────────────
--
-- 🔴 Esta é a única parte do backfill que DESTRÓI dado, e por isso ela não roda
-- sozinha. Um negócio ocupa UMA posição (decisão 5, garantida pelo índice único
-- em `pipeline_entries.deal_id` do passo 6). Numa jornada com dois cards — o par
-- Oportunidades + Orçamentos dos 597 leads — o card de trás não pode continuar
-- existindo como posição: ou ele sai, ou o índice único do passo 6 recusa a base
-- inteira.
--
-- O ADR sustenta a remoção em cima do event-sourcing ("Nothing is lost: the
-- trail is event-sourced already — 47.077 stage events covering 36.312 of 36.812
-- cards"). Isso é **98,6%**, não 100%: para os 1,4% sem evento nenhum, apagar o
-- card apaga o rastro. A guarda abaixo recusa apagar exatamente esses.
--
-- Rodar com `SET LOCAL torque.m4_fundir_jornada = 'on';` antes do arquivo.
-- Sem isso, aborta e diz quantos cards estariam em jogo — de propósito: quem
-- decide apagar card de board de cliente é gente, não script.
DO $$
DECLARE
  v_flag text := coalesce(current_setting('torque.m4_fundir_jornada', true), 'off');
  v_rebaixados bigint; v_sem_rastro bigint;
BEGIN
  SELECT count(*) INTO v_rebaixados FROM _jornada WHERE posto > 1;

  IF v_rebaixados = 0 THEN
    RAISE NOTICE '1b OK: nenhuma jornada com mais de um card nesta org — nada a fundir.';
    RETURN;
  END IF;

  IF v_flag <> 'on' THEN
    RAISE EXCEPTION
      'PARADA DELIBERADA: % card(s) desta org ficariam sem posicao ao fundir a jornada, e some(m) do board. Releia a decisao 11 e, se for isso mesmo, rode com: SET LOCAL torque.m4_fundir_jornada = ''on'';',
      v_rebaixados;
  END IF;

  SELECT count(*) INTO v_sem_rastro
  FROM _jornada j
  WHERE j.posto > 1
    AND NOT EXISTS (SELECT 1 FROM public.pipeline_stage_events e WHERE e.entry_id = j.entry_id);

  IF v_sem_rastro > 0 THEN
    RAISE EXCEPTION
      'FAIL: % dos % card(s) rebaixados NAO tem evento de etapa. O ADR justifica a remocao dizendo que o rastro e event-sourced (98,6%%) — para estes o rastro morre junto. Reconcilie antes.',
      v_sem_rastro, v_rebaixados;
  END IF;

  RAISE NOTICE '1b OK: % card(s) rebaixado(s), todos com rastro em pipeline_stage_events.', v_rebaixados;
END$$;

-- ── 1b. Desligar NOMINALMENTE o gatilho que escreve em `leads` ──────────────
-- Não `session_replication_role = replica`: aquilo desligaria também o reverso
-- do M7 e o sync, e os cards custom ficariam com deal_id NULL na tabela que o
-- kanban renderiza — o buraco exato que o M7 existe para fechar.
-- Preço, por inteiro: exige ser dono da tabela (é de `postgres`); pega ACCESS
-- EXCLUSIVE até o fim da transação; enquanto desligado, nenhuma escrita
-- concorrente sincroniza `pipe_whatsapp`. Aceitável porque isto roda em branch
-- efêmera sem tráfego. Num banco com gente dentro é outra conversa.
-- Transacional: se qualquer guarda abortar, o ROLLBACK religa sozinho.
ALTER TABLE public.pipeline_entries DISABLE TRIGGER trg_sync_whatsapp_stage_to_lead;

-- ── 2. A escrita ────────────────────────────────────────────────────────────
--
-- 2a) UM negócio por jornada, nascido do card eleito (`posto = 1`), com título
--     DERIVADO (decisão 9) em vez do nome do funil.
--
-- O `value` e o `won` vêm do card eleito, que é o mais avançado — é onde o
-- dinheiro está. Somar valor pela jornada seria inventar: o `sale_value` do card
-- de Orçamentos é a proposta, não a soma das etapas anteriores.
--
-- `created_at` do negócio é o do card eleito, e o título deriva dele. Um lead
-- cujo primeiro contato foi em março mas cuja proposta saiu em agosto vira
-- "Negócio de agosto/2026" — a data do negócio é a do ponto onde ele está, não a
-- da primeira mensagem.
WITH novo AS (
  INSERT INTO public.deals (
    organization_id, title, value, owner_id, source_lead_id,
    won, closed_at, notes, metadata, created_at
  )
  SELECT
    j.organization_id,
    public.fn_negocio_titulo_padrao(j.created_at, o.timezone),
    nullif(j.metadata->>'sale_value', '')::numeric,
    j.assigned_to,
    j.lead_id,
    -- IS TRUE, não `= 'won'`: card com stage_key órfão (35 na base) vira false,
    -- nunca NULL
    (j.stage_role = 'won') IS TRUE,
    j.closed_at,
    j.notes,
    jsonb_build_object(
      'backfilled_from_entry', j.entry_id,
      'backfilled_jornada',    j.jornada,
      -- Quantos cards a jornada tinha. Sem isto, depois de fundir não há como
      -- saber que este negócio veio de dois cards em vez de um.
      'backfilled_cards',      (SELECT count(*) FROM _jornada k WHERE k.jornada = j.jornada)
    ),
    j.created_at
  FROM _jornada j
  JOIN public.organizations o ON o.id = j.organization_id
  WHERE j.posto = 1
  RETURNING id, (metadata->>'backfilled_from_entry')::uuid AS entry_id
)
-- 2b) amarra o card ELEITO ao negócio, SEM tocar lead_id
UPDATE public.pipeline_entries pe
   SET deal_id = novo.id
  FROM novo
 WHERE pe.id = novo.entry_id;

-- 2b-bis) o card rebaixado sai. Ver a justificativa e a guarda no bloco 1a-bis:
-- um negócio ocupa uma posição só, e o rastro fica em `pipeline_stage_events`
-- (conferido card a card lá em cima — nenhum sem evento chega aqui).
--
-- `DELETE` e não `closed_at`: card fechado continua sendo posição, continua
-- aparecendo em contagem de coluna, e o índice único do passo 6 não distingue
-- fechado de aberto. Meia-medida aqui vira board mentindo depois.
DELETE FROM public.pipeline_entries pe
 USING _jornada j
 WHERE pe.id = j.entry_id
   AND j.posto > 1
   AND coalesce(current_setting('torque.m4_fundir_jornada', true), 'off') = 'on';

-- ── 2c. Religar ─────────────────────────────────────────────────────────────
-- Fora de bloco condicional de propósito: dentro de um DO com EXCEPTION, um erro
-- poderia deixá-lo desligado numa transação que ainda commita. Aqui, ou esta
-- linha roda, ou nada commita. A guarda 3h ainda confere o catálogo.
ALTER TABLE public.pipeline_entries ENABLE TRIGGER trg_sync_whatsapp_stage_to_lead;

-- ── 3. GUARDA DEPOIS: nada aqui é opcional ──────────────────────────────────
DO $$
DECLARE
  a         _antes%ROWTYPE;
  v_org     uuid := (SELECT org FROM _param);
  v_deals   bigint;
  v_amarr   bigint;
  v_agora   bigint;
  v_scat    bigint;
  v_fp      text;
  v_tgstate "char";
BEGIN
  SELECT * INTO a FROM _antes;

  -- 3a. Negócio criado = card amarrado. É a conferência que teria pego os 2.667
  --     fantasmas — e os DOIS lados escopados por 'backfilled_from_entry', senão
  --     a guarda acusa falso assim que a org criar negócio pela UI.
  SELECT count(*) INTO v_deals FROM public.deals
   WHERE organization_id = v_org AND metadata ? 'backfilled_from_entry';
  SELECT count(*) INTO v_amarr
    FROM public.pipeline_entries pe
    JOIN public.deals d ON d.id = pe.deal_id
   WHERE pe.organization_id = v_org AND d.metadata ? 'backfilled_from_entry';
  IF v_deals <> v_amarr THEN
    RAISE EXCEPTION 'FAIL: % negocio(s) criado(s) para % card(s) amarrado(s) — sobrou fantasma.', v_deals, v_amarr;
  END IF;

  -- 3a-bis. A JORNADA fundiu de verdade (decisão 11).
  --
  -- Duas coisas que só esta guarda pega, e as duas silenciosas:
  --   (i) card rebaixado que sobreviveu — o índice único de `deal_id` do passo 6
  --       recusaria a base inteira depois, longe daqui, sem dizer por quê;
  --   (ii) negócio criado para card rebaixado — seria voltar ao um-por-card sem
  --       ninguém perceber, já que a contagem 3a continuaria batendo.
  SELECT count(*) INTO v_agora
    FROM public.pipeline_entries pe JOIN _jornada j ON j.entry_id = pe.id
   WHERE j.posto > 1;
  IF v_agora <> 0
     AND coalesce(current_setting('torque.m4_fundir_jornada', true), 'off') = 'on' THEN
    RAISE EXCEPTION
      'FAIL: % card(s) rebaixado(s) sobreviveram. O passo 6 (unique em deal_id) vai recusar a base.', v_agora;
  END IF;

  SELECT count(*) INTO v_agora
    FROM public.deals d
   WHERE d.organization_id = v_org
     AND d.metadata ? 'backfilled_from_entry'
     AND EXISTS (SELECT 1 FROM _jornada j
                  WHERE j.entry_id = (d.metadata->>'backfilled_from_entry')::uuid
                    AND j.posto > 1);
  IF v_agora <> 0 THEN
    RAISE EXCEPTION
      'FAIL: % negocio(s) nasceram de card rebaixado — voltou a ser um-por-card.', v_agora;
  END IF;

  -- Um negócio por jornada, e nem um a mais.
  SELECT count(DISTINCT jornada) INTO v_scat FROM _jornada;
  IF v_deals <> v_scat THEN
    RAISE EXCEPTION
      'FAIL: % negocio(s) para % jornada(s) — a decisao 11 pede exatamente um por jornada.', v_deals, v_scat;
  END IF;
  RAISE NOTICE '3a-bis OK: % negocio(s) para % jornada(s), zero card rebaixado sobrevivente.', v_deals, v_scat;

  -- 3b. `lead_id` nunca esvaziado: sem ele a métrica de reunião para em silêncio
  --     (fn_capture_meeting_event casa por lead_id e simplesmente não encontra).
  SELECT count(*) INTO v_agora FROM public.pipeline_entries
   WHERE organization_id = v_org AND lead_id IS NULL;
  IF v_agora <> a.cards_sem_lead THEN
    RAISE EXCEPTION 'FAIL: cards sem lead_id foi de % para %.', a.cards_sem_lead, v_agora;
  END IF;

  -- 3c. Nenhum evento fabricado. As cinco tabelas que o bounce alcançaria se
  --     stage_key mudasse; 0b existe para que não mude, estas provam.
  SELECT count(*) INTO v_agora FROM public.sale_events WHERE organization_id = v_org;
  IF v_agora <> a.sale_events THEN
    RAISE EXCEPTION 'FAIL: sale_events foi de % para %.', a.sale_events, v_agora;
  END IF;
  SELECT count(*) INTO v_agora FROM public.meeting_events WHERE organization_id = v_org;
  IF v_agora <> a.meeting_events THEN
    RAISE EXCEPTION 'FAIL: meeting_events foi de % para %.', a.meeting_events, v_agora;
  END IF;
  SELECT count(*) INTO v_agora FROM public.lead_products WHERE organization_id = v_org;
  IF v_agora <> a.lead_products THEN
    RAISE EXCEPTION 'FAIL: lead_products foi de % para % — a premissa "deal_items vazio" caiu.', a.lead_products, v_agora;
  END IF;
  SELECT count(*) INTO v_agora FROM public.pipeline_stage_events WHERE organization_id = v_org;
  IF v_agora <> a.pipeline_stage_events THEN
    RAISE EXCEPTION 'FAIL: pipeline_stage_events foi de % para % — o bounce moveu card de etapa.', a.pipeline_stage_events, v_agora;
  END IF;
  SELECT count(*) INTO v_agora FROM public.lead_history WHERE organization_id = v_org;
  IF v_agora <> a.lead_history THEN
    RAISE EXCEPTION 'FAIL: lead_history foi de % para % — movimento inventado (a funcao grava justamente quando auth.uid() IS NULL).', a.lead_history, v_agora;
  END IF;

  -- 3c-bis. A classe "gatilho sem lista de colunas", fechada pelo EFEITO.
  --     checklists ← apply_stage_checklist · scheduled_pipe_messages ←
  --     trigger_pipeline_entries_dispatch (que ainda faz net.http_post) ·
  --     workflow_executions ← fire_workflow_trigger · webhook_deliveries ←
  --     enqueue_lead_webhooks (hoje 0 porque `webhooks` está vazia — acidente de
  --     configuração, não desenho: a primeira org que ligar um webhook de lead
  --     receberia 1.885 entregas de um backfill de deal_id).
  SELECT count(*) INTO v_agora FROM public.checklists WHERE organization_id = v_org;
  IF v_agora <> a.checklists THEN
    RAISE EXCEPTION 'FAIL: checklists foi de % para % — apply_stage_checklist rodou.', a.checklists, v_agora;
  END IF;
  SELECT count(*) INTO v_agora FROM public.scheduled_pipe_messages WHERE organization_id = v_org;
  IF v_agora <> a.scheduled_msgs THEN
    RAISE EXCEPTION 'FAIL: scheduled_pipe_messages foi de % para % — o backfill AGENDOU DISPARO DE WHATSAPP.', a.scheduled_msgs, v_agora;
  END IF;
  SELECT count(*) INTO v_agora FROM public.workflow_executions WHERE organization_id = v_org;
  IF v_agora <> a.workflow_execs THEN
    RAISE EXCEPTION 'FAIL: workflow_executions foi de % para % — o backfill disparou automacao.', a.workflow_execs, v_agora;
  END IF;
  SELECT count(*) INTO v_agora FROM public.webhook_deliveries;
  IF v_agora <> a.webhook_deliveries THEN
    RAISE EXCEPTION 'FAIL: webhook_deliveries (global) foi de % para % — enqueue_lead_webhooks rodou.', a.webhook_deliveries, v_agora;
  END IF;

  -- 3d. O espelho custom recebeu o vínculo (M7). A checagem de coluna vem antes
  --     de propósito: sem M7 o SELECT seguinte falharia com "column does not
  --     exist" — aborta igual, com mensagem que não explica nada.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='custom_pipe_entries'
                    AND column_name='deal_id') THEN
    RAISE EXCEPTION 'FAIL: custom_pipe_entries.deal_id nao existe — M7 nao foi aplicado.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.custom_pipe_entries c
              JOIN public.pipeline_entries pe ON pe.id = c.id
             WHERE c.organization_id = v_org
               AND pe.deal_id IS NOT NULL AND c.deal_id IS NULL) THEN
    RAISE EXCEPTION 'FAIL: card custom com deal_id no espelho e NULL na fonte — o gatilho reverso do M7 nao esta no lugar.';
  END IF;

  -- 3e. `leads` intacto, byte a byte. Razão de existir do passo 1b.
  SELECT md5(coalesce(string_agg(l.id::text || '=' || coalesce(l.pipe_whatsapp, '<null>'), ',' ORDER BY l.id), ''))
    INTO v_fp FROM public.leads l WHERE l.organization_id = v_org;
  IF v_fp IS DISTINCT FROM a.leads_fp THEN
    RAISE EXCEPTION
      'FAIL: leads.pipe_whatsapp MUDOU (fingerprint % -> %). O backfill escreveu em dado de cliente.', a.leads_fp, v_fp;
  END IF;

  -- 3f. `stage_changed_at` do espelho: mutação declarada, mas só onde já divergia.
  SELECT count(*) INTO v_agora
    FROM _snap_scat s JOIN public.pipeline_entries pe ON pe.id = s.id
   WHERE pe.stage_changed_at IS DISTINCT FROM s.stage_changed_at;
  SELECT count(*) INTO v_scat FROM _snap_scat WHERE divergia_antes;
  IF v_agora <> v_scat THEN
    RAISE EXCEPTION
      'FAIL: stage_changed_at mudou em % card(s), mas so % divergiam antes. O bounce saiu do previsto.', v_agora, v_scat;
  END IF;

  -- 3g. `enforce_closed_at_on_final_stage` carimba NOW() em card final com
  --     closed_at NULL, sem comparar com OLD. Hoje são 0 na base — inerte por
  --     DADO, não por desenho. No dia em que deixar de ser, para aqui.
  SELECT count(*) INTO v_agora
    FROM public.custom_pipe_entries c JOIN public.pipeline_entries pe ON pe.id = c.id
   WHERE c.organization_id = v_org AND pe.stage_key IN ('vendido','perdido') AND pe.closed_at IS NULL;
  IF v_agora <> 0 THEN
    RAISE EXCEPTION 'FAIL: % card(s) custom em estagio final com closed_at NULL — data de fechamento inventada.', v_agora;
  END IF;

  -- 3h. O gatilho de `leads` voltou LIGADO ('O' = origin). Desligado em silêncio
  --     é pior que o problema original: pipe_whatsapp para de sincronizar.
  SELECT t.tgenabled INTO v_tgstate FROM pg_trigger t
   WHERE t.tgrelid = 'public.pipeline_entries'::regclass
     AND t.tgname  = 'trg_sync_whatsapp_stage_to_lead' AND NOT t.tgisinternal;
  IF v_tgstate IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION 'FAIL: trg_sync_whatsapp_stage_to_lead ficou em estado % (esperado O).', coalesce(v_tgstate::text, 'AUSENTE');
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: % negocio(s) amarrado(s). lead_id intacto; leads.pipe_whatsapp byte-a-byte igual; sale/meeting/lead_products/stage_events/lead_history/checklists/scheduled_msgs/workflow_execs/webhook_deliveries inalterados; stage_changed_at mudou so nos % ja divergentes; gatilho religado.', v_deals, v_scat;
  RAISE NOTICE 'RELATORIO (nao e falha): % lead(s) desta org tem pipe_whatsapp divergente do card de whatsapp. Drift PREEXISTENTE, deliberadamente NAO reconciliado aqui — vira script proprio, com decisao propria sobre qual lado esta certo.', a.wa_drift_preexistente;
END$$;
