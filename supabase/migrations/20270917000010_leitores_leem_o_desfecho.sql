-- B2c — os leitores passam a ler o DESFECHO do negócio, não o papel da etapa.
--
-- Terceira fatia do arco B. Ver .specs/agenda-fonte-unica/PLANO.md.
--
-- ── Por que o papel da etapa não serve como fonte ────────────────────────
-- `stage_role` é INFERIDO do nome da etapa por `system_stage_role()` e pela
-- fila de revisão. Inferência erra, e erra muito. Medido em prod:
--
--   76 etapas que parecem perda estão com papel ≠ 'lost'  (contra 249 certas)
--    5 etapas que parecem ganho estão com papel ≠ 'won'   (contra 126 certas)
--
-- 23% de falha no lado da perda. `deals.outcome` não é inferido: é escrito por
-- quem decidiu — o botão, o arrastar do card ou a automação.
--
-- ── O que passa a aparecer ───────────────────────────────────────────────
-- 519 fechamentos que a etapa não enxerga. A composição deles é a prova de
-- que a troca é correção, não inflação:
--
--   438  card em etapa chamada `perdido`, papel classificado como `open`
--    24  card em `desqualificado_numero_invalido`, papel `open`
--     8  card em `perdido`, sem linha de etapa nenhuma
--     7  card em `vendido`, papel `open` — e negócio dizendo `lost` ⚠️
--    42  demais
--
-- Ou seja: são perdas reais cuja ETAPA nunca foi classificada. O negócio está
-- certo; o papel da etapa é que está em branco.
--
-- ⚠️ Os 7 da linha marcada são contradição genuína e NÃO são consertados
-- aqui: são vendas do funil `whatsapp` que o backfill de 20270904000000
-- classificou como perda (`closed_at IS NOT NULL AND won IS NOT TRUE`, com
-- `won` nunca escrito). Corrigi-los emite evento permanente num livro
-- append-only e é decisão do CTO, não efeito colateral desta migration.
-- São 7 em 1.701 perdas — 0,4%.
--
-- ── E nada se perde ──────────────────────────────────────────────────────
-- Medido antes de escrever: 1.567 cards em etapa de desfecho, TODOS com
-- negócio, NENHUM discordando. O desfecho é superconjunto estrito da etapa.
-- Nenhum card sem negócio some dos recortes.
--
-- ── Impacto medido, função a função ──────────────────────────────────────
-- `get_pipeline_velocity`, todas as 108 orgs:
--   5 orgs mudam de número · ganhos +0 · fechados +10
--   ticket médio se move porque o valor passa a sair de `deals.value`
--
-- ── O valor sai do negócio, e é a fonte mais limpa ───────────────────────
-- Antes: `pe.metadata->>'sale_value'`, texto livre gravado pelo front. Ele
-- guarda o resíduo de ponto flutuante do JavaScript — medido em prod,
-- `10311.350000000002` onde `deals.value` tem `10311.35`. São 27 pares que
-- divergem só nisso, na ordem de 1e-12.
--
-- Desde a 20270916000010 `deals.value` é fonte única: a trava recupera da
-- metadata quando o valor só existe lá, e o backfill zerou o resíduo (0
-- negócios com valor apenas na entrada).
--
-- ── ⚠️ `get_pending_meta_conversion_signals` está inerte ─────────────────
-- Portada aqui por completude, mas a função devolve ZERO linhas hoje e
-- continuará devolvendo: `meta_asset_bindings` tem **0 linhas**, e o JOIN
-- com binding ativo mata todos os candidatos antes de qualquer filtro de
-- desfecho. 167 sinais já foram enviados no passado e 109 leads têm
-- `meta_lead_id` — a porta fechou depois disso, num ponto anterior ao que
-- esta fatia toca.
--
-- ── Fora de escopo, e por quê ────────────────────────────────────────────
-- `get_funnel_flow` e `_metric_leaf_coorte_etapa` também decidem por papel de
-- etapa e NÃO estavam no mapa dos 15 pontos — foram achados nesta varredura.
-- Ficam para uma fatia própria: as duas medem a JORNADA por etapas
-- (`pipeline_stage_events`), não o desfecho, e portá-las é outra pergunta.
--
-- Reaplicar é no-op.

CREATE OR REPLACE FUNCTION public.get_pipeline_velocity(p_pipeline_type text DEFAULT NULL::text, p_start_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_org_id uuid DEFAULT NULL::uuid, p_pipeline_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
  v_pipeline_id uuid;
  v_result jsonb;
BEGIN
  v_org_id := public.resolve_org_for_rpc(p_org_id);
  IF v_org_id IS NULL THEN RETURN '{}'::jsonb; END IF;

  -- COALESCE(slug,'propostas') preserva o default legado do alias.
  SELECT p.id INTO v_pipeline_id
  FROM public.pipelines p
  WHERE p.organization_id = v_org_id
    AND ((p_pipeline_id IS NOT NULL AND p.id = p_pipeline_id)
      OR (p_pipeline_id IS NULL AND p.slug = COALESCE(p_pipeline_type, 'propostas')));

  -- Funil inexistente: objeto zerado, mesmo shape do legado sem linhas.
  IF v_pipeline_id IS NULL THEN
    RETURN jsonb_build_object('num_won', 0, 'total_closed', 0, 'win_rate', 0, 'avg_deal_value', ROUND(0::numeric, 2));
  END IF;

  WITH closed_deals AS (
    -- B2c: o desfecho vem do NEGÓCIO, não da etapa. `stage_role` é inferido do
    -- nome da etapa e erra: 76 etapas que parecem perda estão com papel errado,
    -- contra 249 corretas — 23% de falha. `deals.outcome` é escrito pela
    -- decisão (botão, arrastar ou automação), não adivinhado.
    --
    -- Medido em prod: 1.567 cards em etapa de desfecho, TODOS com negócio e
    -- NENHUM discordando — o desfecho é superconjunto estrito, nada se perde.
    -- E 519 fechamentos que a etapa não enxergava passam a contar, dos quais
    -- 446 estão numa etapa literalmente chamada "perdido" nunca classificada.
    --
    -- `sale_value` sai de `deals.value`: desde a 20270916000010 ele é a fonte
    -- única (a trava recupera da metadata quando o valor só existe lá, e o
    -- backfill zerou o resíduo — 0 negócios com valor apenas na entrada).
    SELECT d.outcome AS desfecho, d.value AS sale_value
    FROM public.pipeline_entries pe
    JOIN public.deals d ON d.id = pe.deal_id
    WHERE pe.organization_id = v_org_id
      AND pe.pipeline_id = v_pipeline_id
      AND d.outcome IN ('won', 'lost')
      AND (p_start_date IS NULL OR pe.created_at >= p_start_date)
      AND (p_end_date IS NULL OR pe.created_at <= p_end_date)
  )
  SELECT jsonb_build_object(
    'num_won', COUNT(*) FILTER (WHERE cd.desfecho = 'won'),
    'total_closed', COUNT(*),
    'win_rate', CASE WHEN COUNT(*) > 0
      THEN ROUND((COUNT(*) FILTER (WHERE cd.desfecho = 'won'))::numeric / COUNT(*) * 100, 1)
      ELSE 0 END,
    'avg_deal_value', ROUND(COALESCE(AVG(cd.sale_value) FILTER (WHERE cd.desfecho = 'won'), 0)::numeric, 2)
  ) INTO v_result
  FROM closed_deals cd;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_analytics_pipeline_metrics(p_org_id uuid, p_start_date date, p_end_date date, p_pipeline_type text DEFAULT NULL::text, p_member_id uuid DEFAULT NULL::uuid, p_pipeline_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  result jsonb;
  v_end_ts timestamptz := (p_end_date + interval '1 day');
  v_pipeline_id uuid;
  v_filtered boolean := (p_pipeline_id IS NOT NULL OR p_pipeline_type IS NOT NULL);
BEGIN
  PERFORM public.assert_org_access(p_org_id);

  IF v_filtered THEN
    SELECT p.id INTO v_pipeline_id
    FROM public.pipelines p
    WHERE p.organization_id = p_org_id
      AND ((p_pipeline_id IS NOT NULL AND p.id = p_pipeline_id)
        OR (p_pipeline_id IS NULL AND p.slug = p_pipeline_type));
    -- Filtro pedido e inexistente: recortes filtrados ficam vazios (idêntico
    -- ao legado com p_pipeline_type fora do trio).
  END IF;

  WITH
  -- ─── FULL-FUNNEL (jornada da org — inalterado byte-a-byte) ────────────────
  leads_created AS (
    SELECT l.id AS lead_id, l.created_at
    FROM leads l
    WHERE l.organization_id = p_org_id
           AND NOT public.lead_excluded_from_metrics(l.id, p_org_id)
      AND COALESCE(l.metrics_period_at, l.created_at) >= p_start_date
      AND COALESCE(l.metrics_period_at, l.created_at) < v_end_ts
      AND (p_member_id IS NULL OR EXISTS (
        SELECT 1 FROM pipe_whatsapp pw
        WHERE pw.lead_id = l.id AND pw.organization_id = p_org_id AND pw.sdr_id = p_member_id
      ))
  ),
  leads_count AS (
    SELECT COUNT(*) AS cnt FROM leads_created
  ),
  qualified_leads AS (
    SELECT DISTINCT pw.lead_id
    FROM pipe_whatsapp pw
    JOIN leads_created lc ON lc.lead_id = pw.lead_id
    WHERE pw.organization_id = p_org_id
      AND (p_member_id IS NULL OR pw.sdr_id = p_member_id)
  ),
  qualified_count AS (
    SELECT COUNT(*) AS cnt FROM qualified_leads
  ),
  whatsapp_lost AS (
    SELECT COUNT(DISTINCT pw.lead_id) AS cnt
    FROM pipe_whatsapp pw
    JOIN leads_created lc ON lc.lead_id = pw.lead_id
    WHERE pw.organization_id = p_org_id
      AND pw.status = 'esfriou'
      AND NOT EXISTS (
        SELECT 1 FROM meeting_events me WHERE me.lead_id = pw.lead_id AND me.organization_id = p_org_id AND me.event_type = 'meeting_booked'
      )
  ),
  attended_leads AS (
    SELECT DISTINCT me.lead_id
    FROM meeting_events me
    JOIN leads_created lc ON lc.lead_id = me.lead_id
    WHERE me.organization_id = p_org_id
      AND me.event_type = 'meeting_held'
      AND (p_member_id IS NULL OR me.pre_sale_responsible_id = p_member_id)
  ),
  attended_count AS (
    SELECT COUNT(*) AS cnt FROM attended_leads
  ),
  proposta_leads AS (SELECT DISTINCT pp.lead_id FROM pipe_propostas pp JOIN leads_created lc ON lc.lead_id = pp.lead_id WHERE pp.organization_id = p_org_id AND (p_member_id IS NULL OR pp.closer_id = p_member_id OR pp.responsible_id = p_member_id)),
  proposta_count AS (SELECT COUNT(*) AS cnt FROM proposta_leads),
  confirmacao_lost AS (
    SELECT COUNT(DISTINCT me.lead_id) AS cnt
    FROM meeting_events me
    JOIN leads_created lc ON lc.lead_id = me.lead_id
    WHERE me.organization_id = p_org_id
      AND me.event_type = 'meeting_booked'
      AND me.meeting_date IS NOT NULL
      AND me.meeting_date < NOW()
      AND NOT EXISTS (
        SELECT 1 FROM meeting_events h
        WHERE h.event_type = 'meeting_held' AND h.booked_event_id = me.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM attended_leads al WHERE al.lead_id = me.lead_id
      )
  ),
  -- B2c: ganho lido do NEGÓCIO. Antes vinha de `pipe_propostas.status =
  -- 'vendido'` — um slug de etapa da view legada, cego para funil custom e
  -- para venda decidida pelo botão sem mover o card.
  won_leads AS (
    SELECT DISTINCT pe.lead_id
    FROM pipeline_entries pe
    JOIN deals d ON d.id = pe.deal_id
    JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.organization_id = p_org_id
    JOIN leads_created lc ON lc.lead_id = pe.lead_id
    WHERE pe.organization_id = p_org_id
      AND pip.slug = 'propostas'
      AND d.outcome = 'won'
      AND (p_member_id IS NULL
        OR pe.metadata->>'closer_id' = p_member_id::text
        OR pe.metadata->>'responsible_id' = p_member_id::text)
  ),
  won_count AS (
    SELECT COUNT(*) AS cnt FROM won_leads
  ),
  -- B2c: perda lida do NEGÓCIO, mesmo motivo do bloco acima.
  propostas_lost AS (
    SELECT COUNT(DISTINCT pe.lead_id) AS cnt
    FROM pipeline_entries pe
    JOIN deals d ON d.id = pe.deal_id
    JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.organization_id = p_org_id
    JOIN leads_created lc ON lc.lead_id = pe.lead_id
    WHERE pe.organization_id = p_org_id
      AND pip.slug = 'propostas'
      AND d.outcome = 'lost'
  ),
  avg_days_whatsapp AS (
    SELECT ROUND(AVG(EXTRACT(EPOCH FROM (pw.updated_at - lc.created_at)) / 86400)::numeric, 1) AS avg_days
    FROM pipe_whatsapp pw
    JOIN leads_created lc ON lc.lead_id = pw.lead_id
    WHERE pw.organization_id = p_org_id
  ),
  avg_days_confirmacao AS (
    SELECT ROUND(AVG(EXTRACT(EPOCH FROM (me.occurred_at - pw.created_at)) / 86400)::numeric, 1) AS avg_days
    FROM meeting_events me
    JOIN pipe_whatsapp pw ON pw.lead_id = me.lead_id AND pw.organization_id = p_org_id
    JOIN leads_created lc ON lc.lead_id = me.lead_id
    WHERE me.organization_id = p_org_id
      AND me.event_type = 'meeting_booked'
  ),
  avg_days_propostas AS (
    SELECT ROUND(AVG(EXTRACT(EPOCH FROM (pp.updated_at - me.occurred_at)) / 86400)::numeric, 1) AS avg_days
    FROM pipe_propostas pp
    JOIN meeting_events me ON me.lead_id = pp.lead_id AND me.organization_id = p_org_id AND me.event_type = 'meeting_booked'
    JOIN leads_created lc ON lc.lead_id = pp.lead_id
    WHERE pp.organization_id = p_org_id
  ),

  -- ─── PIPELINE AGING (D-agz: genérico por funil; custom entra) ─────────────
  -- Estado atual, sem filtro de data (como o legado). "Ainda em jogo" deixou
  -- de ser propriedade da ETAPA e passou a ser do NEGÓCIO (B2c) — ver o
  -- cabeçalho. Âncora: stage_changed_at = tempo NA etapa (o legado usava
  -- updated_at = último toque, que rejuvenescia o card a cada edição).
  combined_aging AS (
    SELECT
      CASE WHEN v_filtered THEN ps.name ELSE pip.name || ' · ' || ps.name END AS stage_name,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (NOW() - COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at))) / 86400 < 3) AS healthy_count,
      COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (NOW() - COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at))) / 86400 BETWEEN 3 AND 6.9999) AS attention_count,
      COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (NOW() - COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at))) / 86400 BETWEEN 7 AND 13.9999) AS risk_count,
      COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (NOW() - COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at))) / 86400 >= 14) AS critical_count,
      MIN(pip.display_order) AS pipe_ord,
      MIN(ps.position) AS stage_pos
    FROM pipeline_entries pe
    JOIN pipelines pip
      ON pip.id = pe.pipeline_id
     AND pip.organization_id = p_org_id
     AND pip.is_active
    JOIN pipeline_stages ps
      ON ps.pipeline_id = pe.pipeline_id
     AND ps.stage_key = pe.stage_key
    LEFT JOIN deals d ON d.id = pe.deal_id
    WHERE pe.organization_id = p_org_id
      AND (NOT v_filtered OR pe.pipeline_id = v_pipeline_id)
      -- B2c: "ainda em jogo" = o NEGÓCIO não foi decidido. A etapa continua
      -- dando o nome e a ordem da linha; ela só deixa de decidir o desfecho.
      -- LEFT JOIN porque card sem negócio é card aberto — não some da esteira.
      AND COALESCE(d.outcome, 'open') NOT IN ('won', 'lost')
      AND (p_member_id IS NULL
        OR pe.assigned_to = p_member_id
        OR pe.metadata->>'closer_id' = p_member_id::text
        OR pe.metadata->>'responsible_id' = p_member_id::text
        OR pe.metadata->>'sdr_id' = p_member_id::text
        OR pe.metadata->>'pre_sale_responsible_id' = p_member_id::text
        OR pe.metadata->>'sale_responsible_id' = p_member_id::text)
    GROUP BY pip.id, pip.name, ps.id, ps.name
  ),

  -- ─── WEIGHTED FORECAST (D-fx: funil resolvido, ou todos sem filtro) ───────
  -- Pondera o VALOR ABERTO do pipeline — não é receita. Receita realizada é
  -- exclusiva do caderno sale_events (ADR-0017); este bloco nunca soma venda
  -- fechada (negócio com desfecho decidido fica de fora, B2c).
  -- Probabilidade: default_probability da PRÓPRIA etapa (mecanismo, editável
  -- por org) / 100, fallback 0.50 — substitui a tabela fixa por slug que
  -- ainda por cima descartava proposta_enviada.
  weighted_forecast AS (
    SELECT
      CASE WHEN v_filtered THEN ps.name ELSE pip.name || ' · ' || ps.name END AS stage_name,
      COUNT(*) AS deal_count,
      COALESCE(SUM((pe.metadata->>'sale_value')::numeric), 0) AS total_value,
      ROUND(COALESCE(MIN(ps.default_probability), 50)::numeric / 100.0, 2) AS win_probability,
      ROUND((COALESCE(SUM((pe.metadata->>'sale_value')::numeric), 0)
             * COALESCE(MIN(ps.default_probability), 50)::numeric / 100.0), 2) AS weighted_value,
      MIN(pip.display_order) AS pipe_ord,
      MIN(ps.position) AS stage_pos
    FROM pipeline_entries pe
    JOIN pipelines pip
      ON pip.id = pe.pipeline_id
     AND pip.organization_id = p_org_id
     AND pip.is_active
    JOIN pipeline_stages ps
      ON ps.pipeline_id = pe.pipeline_id
     AND ps.stage_key = pe.stage_key
    LEFT JOIN deals d ON d.id = pe.deal_id
    WHERE pe.organization_id = p_org_id
      AND (NOT v_filtered OR pe.pipeline_id = v_pipeline_id)
      -- B2c: mesma troca da esteira. Aqui ela importa mais: previsão que
      -- inclui negócio já fechado promete receita que já entrou ou já morreu.
      AND COALESCE(d.outcome, 'open') NOT IN ('won', 'lost')
      AND pe.created_at >= p_start_date
      AND pe.created_at < v_end_ts
      AND (p_member_id IS NULL
        OR pe.assigned_to = p_member_id
        OR pe.metadata->>'closer_id' = p_member_id::text
        OR pe.metadata->>'responsible_id' = p_member_id::text
        OR pe.metadata->>'sdr_id' = p_member_id::text
        OR pe.metadata->>'pre_sale_responsible_id' = p_member_id::text
        OR pe.metadata->>'sale_responsible_id' = p_member_id::text)
    GROUP BY pip.id, pip.name, ps.id, ps.name
    HAVING COALESCE(SUM((pe.metadata->>'sale_value')::numeric), 0) > 0
  ),

  -- ─── CONVERSION TRENDS (últimos 6 meses; [0..2] byte-a-byte) ──────────────
  months_series AS (
    SELECT
      TO_CHAR(generate_series(
        DATE_TRUNC('month', NOW() - interval '5 months'),
        DATE_TRUNC('month', NOW()),
        interval '1 month'
      ), 'Mon/YY') AS month_label,
      generate_series(
        DATE_TRUNC('month', NOW() - interval '5 months'),
        DATE_TRUNC('month', NOW()),
        interval '1 month'
      ) AS month_start
  ),
  monthly_leads AS (
    SELECT
      m.month_label,
      m.month_start,
      COUNT(DISTINCT l.id) AS lead_cnt
    FROM months_series m
    LEFT JOIN leads l ON l.organization_id = p_org_id
           AND NOT public.lead_excluded_from_metrics(l.id, p_org_id)
      AND l.created_at >= m.month_start
      AND l.created_at < m.month_start + interval '1 month'
    GROUP BY m.month_label, m.month_start
  ),
  monthly_qualified AS (
    SELECT
      m.month_label,
      COUNT(DISTINCT pw.lead_id) AS qualified_cnt
    FROM months_series m
    LEFT JOIN pipe_whatsapp pw ON pw.organization_id = p_org_id
      AND pw.created_at >= m.month_start
      AND pw.created_at < m.month_start + interval '1 month'
      AND (p_member_id IS NULL OR pw.sdr_id = p_member_id)
    GROUP BY m.month_label
  ),
  monthly_meetings AS (
    SELECT
      m.month_label,
      COUNT(DISTINCT me.lead_id) AS meeting_cnt
    FROM months_series m
    LEFT JOIN meeting_events me ON me.organization_id = p_org_id
      AND me.event_type = 'meeting_held'
      AND COALESCE(me.meeting_date, me.occurred_at) >= m.month_start
      AND COALESCE(me.meeting_date, me.occurred_at) < m.month_start + interval '1 month'
      AND (p_member_id IS NULL OR me.pre_sale_responsible_id = p_member_id)
    GROUP BY m.month_label
  ),
  -- 'vendido no mês' do funil propostas.
  -- B2c: o ganho vem de `deals.outcome` e a âncora passa a ser
  -- `deals.outcome_at` — o instante em que a venda foi DECIDIDA, gravado por
  -- quem decidiu. Antes: COALESCE(pe.closed_at, pe.stage_changed_at), que
  -- descreve o card, não o negócio; mover o card depois movia a venda de mês.
  --
  -- A 20270914000020 (B2b) devolveu a `outcome_at` a data real de 543
  -- fechamentos que o B1 tinha carimbado com a data da migration. Sem aquilo,
  -- ancorar aqui empilharia 465 vendas num único mês.
  monthly_won AS (
    SELECT
      m.month_label,
      COUNT(DISTINCT w.lead_id) AS won_cnt
    FROM months_series m
    LEFT JOIN (
      SELECT pe.lead_id,
             d.outcome_at AS won_at,
             pe.metadata
      FROM pipeline_entries pe
      JOIN deals d
        ON d.id = pe.deal_id
       AND d.outcome = 'won'
      JOIN pipelines pip
        ON pip.id = pe.pipeline_id
       AND pip.organization_id = p_org_id
       AND pip.slug = 'propostas'
      WHERE pe.organization_id = p_org_id
    ) w ON w.won_at >= m.month_start
       AND w.won_at < m.month_start + interval '1 month'
       AND (p_member_id IS NULL
         OR w.metadata->>'closer_id' = p_member_id::text
         OR w.metadata->>'responsible_id' = p_member_id::text)
    GROUP BY m.month_label
  ),
  monthly_proposta AS (
    SELECT
      m.month_label,
      COUNT(DISTINCT pp.lead_id) AS proposta_cnt
    FROM months_series m
    LEFT JOIN pipe_propostas pp ON pp.organization_id = p_org_id
      AND pp.created_at >= m.month_start
      AND pp.created_at < m.month_start + interval '1 month'
      AND (p_member_id IS NULL OR pp.closer_id = p_member_id OR pp.responsible_id = p_member_id)
    GROUP BY m.month_label
  ),
  trends_combined AS (
    SELECT
      ml.month_label,
      ml.lead_cnt,
      COALESCE(mq.qualified_cnt, 0) AS qualified_cnt,
      COALESCE(mm.meeting_cnt, 0) AS meeting_cnt,
      COALESCE(mp.proposta_cnt, 0) AS proposta_cnt,
      COALESCE(mw.won_cnt, 0) AS won_cnt
    FROM monthly_leads ml
    LEFT JOIN monthly_qualified mq ON mq.month_label = ml.month_label
    LEFT JOIN monthly_meetings mm ON mm.month_label = ml.month_label
    LEFT JOIN monthly_proposta mp ON mp.month_label = ml.month_label
    LEFT JOIN monthly_won mw ON mw.month_label = ml.month_label
    ORDER BY ml.month_start
  )

  SELECT jsonb_build_object(
    -- Full funnel stages (jornada da org: só sem filtro de funil, como antes)
    'funnel_stages', CASE WHEN NOT v_filtered THEN
      jsonb_build_array(
        jsonb_build_object(
          'stage_name', 'Leads Criados',
          'count', (SELECT cnt FROM leads_count),
          'cumulative_pct', 100,
          'lost_count', 0,
          'avg_days', 0
        ),
        jsonb_build_object(
          'stage_name', 'Qualificação (WhatsApp)',
          'count', (SELECT cnt FROM qualified_count),
          'cumulative_pct', ROUND(COALESCE((SELECT cnt FROM qualified_count)::numeric / NULLIF((SELECT cnt FROM leads_count), 0) * 100, 0), 1),
          'lost_count', (SELECT cnt FROM whatsapp_lost),
          'avg_days', COALESCE((SELECT avg_days FROM avg_days_whatsapp), 0)
        ),
        jsonb_build_object(
          'stage_name', 'Reunião (Compareceu)',
          'count', (SELECT cnt FROM attended_count),
          'cumulative_pct', ROUND(COALESCE((SELECT cnt FROM attended_count)::numeric / NULLIF((SELECT cnt FROM leads_count), 0) * 100, 0), 1),
          'lost_count', (SELECT cnt FROM confirmacao_lost),
          'avg_days', COALESCE((SELECT avg_days FROM avg_days_confirmacao), 0)
        ),
        jsonb_build_object(
          'stage_name', 'Vendido',
          'count', (SELECT cnt FROM won_count),
          'cumulative_pct', ROUND(COALESCE((SELECT cnt FROM won_count)::numeric / NULLIF((SELECT cnt FROM leads_count), 0) * 100, 0), 1),
          'lost_count', (SELECT cnt FROM propostas_lost),
          'avg_days', COALESCE((SELECT avg_days FROM avg_days_propostas), 0)
        )
      )
    ELSE '[]'::jsonb END,

    -- Stage analysis (transition conversion)
    'stage_analysis', CASE WHEN NOT v_filtered THEN
      jsonb_build_array(
        jsonb_build_object(
          'transition_name', 'Lead → Qualificação',
          'conversion_pct', ROUND(COALESCE((SELECT cnt FROM qualified_count)::numeric / NULLIF((SELECT cnt FROM leads_count), 0) * 100, 0), 1),
          'lost_count', (SELECT cnt FROM leads_count) - (SELECT cnt FROM qualified_count),
          'primary_loss_status', 'sem_contato'
        ),
        jsonb_build_object(
          'transition_name', 'Qualificação → Reunião',
          'conversion_pct', ROUND(COALESCE((SELECT cnt FROM attended_count)::numeric / NULLIF((SELECT cnt FROM qualified_count), 0) * 100, 0), 1),
          'lost_count', (SELECT cnt FROM whatsapp_lost),
          'primary_loss_status', 'esfriou'
        ),
        jsonb_build_object(
          'transition_name', 'Reunião → Proposta',
          'conversion_pct', ROUND(COALESCE((SELECT cnt FROM proposta_count)::numeric / NULLIF((SELECT cnt FROM attended_count), 0) * 100, 0), 1),
          'lost_count', (SELECT cnt FROM confirmacao_lost),
          'primary_loss_status', 'perdido'
        ),
        jsonb_build_object(
          'transition_name', 'Proposta → Venda',
          'conversion_pct', ROUND(COALESCE((SELECT cnt FROM won_count)::numeric / NULLIF((SELECT cnt FROM proposta_count), 0) * 100, 0), 1),
          'lost_count', (SELECT cnt FROM propostas_lost),
          'primary_loss_status', 'perdido'
        )
      )
    ELSE '[]'::jsonb END,

    -- Pipeline aging (ordenado por funil e posição da etapa)
    'pipeline_aging', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'stage_name', ca.stage_name,
        'total', ca.total,
        'healthy_count', ca.healthy_count,
        'attention_count', ca.attention_count,
        'risk_count', ca.risk_count,
        'critical_count', ca.critical_count
      ) ORDER BY ca.pipe_ord, ca.stage_pos) FROM combined_aging ca WHERE ca.total > 0),
      '[]'::jsonb
    ),

    -- Weighted forecast
    'weighted_forecast', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'stage_name', wf.stage_name,
        'deal_count', wf.deal_count,
        'total_value', wf.total_value,
        'win_probability', wf.win_probability,
        'weighted_value', wf.weighted_value
      ) ORDER BY wf.pipe_ord, wf.stage_pos) FROM weighted_forecast wf),
      '[]'::jsonb
    ),

    -- Conversion trends (4 transitions, 6 months each)
    'conversion_trends', jsonb_build_array(
      jsonb_build_object(
        'transition_name', 'Lead → Qualificado',
        'months', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'month_label', tc.month_label,
            'rate', ROUND(COALESCE(tc.qualified_cnt::numeric / NULLIF(tc.lead_cnt, 0) * 100, 0), 1)
          ) ORDER BY month_label)
          FROM trends_combined tc
        ), '[]'::jsonb)
      ),
      jsonb_build_object(
        'transition_name', 'Qualificado → Reunião',
        'months', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'month_label', tc.month_label,
            'rate', ROUND(COALESCE(tc.meeting_cnt::numeric / NULLIF(tc.qualified_cnt, 0) * 100, 0), 1)
          ) ORDER BY month_label)
          FROM trends_combined tc
        ), '[]'::jsonb)
      ),
      jsonb_build_object(
        'transition_name', 'Reunião → Proposta',
        'months', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'month_label', tc.month_label,
            'rate', ROUND(COALESCE(tc.proposta_cnt::numeric / NULLIF(tc.meeting_cnt, 0) * 100, 0), 1)
          ) ORDER BY month_label)
          FROM trends_combined tc
        ), '[]'::jsonb)
      ),
      jsonb_build_object(
        'transition_name', 'Proposta → Venda',
        'months', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'month_label', tc.month_label,
            'rate', ROUND(COALESCE(tc.won_cnt::numeric / NULLIF(tc.proposta_cnt, 0) * 100, 0), 1)
          ) ORDER BY month_label)
          FROM trends_combined tc
        ), '[]'::jsonb)
      )
    ),

    -- Totals
    'pipeline_total', (SELECT cnt FROM leads_count),
    'forecast_total', COALESCE(
      (SELECT SUM(wf.weighted_value) FROM weighted_forecast wf),
      0
    )
  ) INTO result;

  RETURN result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_pending_meta_conversion_signals()
 RETURNS TABLE(lead_id uuid, organization_id uuid, meta_lead_id text, event_name text, ad_account_id text, dataset_override text, email text, phone text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cand AS (
    SELECT l.id AS lead_id, l.organization_id, l.meta_lead_id, 'initial'::text AS event_name, 0 AS rnk, l.email, l.phone
    FROM public.leads l WHERE l.meta_lead_id IS NOT NULL
    UNION ALL
    SELECT l.id, l.organization_id, l.meta_lead_id, 'qualified', 1, l.email, l.phone
    FROM public.leads l
    WHERE l.meta_lead_id IS NOT NULL
      AND COALESCE(l.qualification_tier::text, l.pre_qualification_tier::text) IN ('prata','ouro','diamante')
    UNION ALL
    SELECT l.id, l.organization_id, l.meta_lead_id, 'meeting', 2, l.email, l.phone
    FROM public.leads l WHERE l.meta_lead_id IS NOT NULL AND l.pipe_whatsapp = 'compareceu'
    UNION ALL
    -- `sold`: negócio ganho em QUALQUER funil.
    -- B2c: lido de `deals.outcome`, não de `metric_stage_role`. O papel da
    -- etapa é inferido do nome e erra em 23% dos casos de perda; o desfecho é
    -- escrito pela decisão. Aqui o erro custa caro em dinheiro alheio: sinal
    -- de conversão enviado à Meta treina a otimização de campanha, e um `sold`
    -- que nunca foi venda ensina o algoritmo a buscar o público errado.
    SELECT l.id, l.organization_id, l.meta_lead_id, 'sold', 3, l.email, l.phone
    FROM public.leads l
    WHERE l.meta_lead_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.pipeline_entries pe
        JOIN public.deals d ON d.id = pe.deal_id
        WHERE pe.lead_id = l.id
          AND pe.organization_id = l.organization_id
          AND d.outcome = 'won'
      )
  )
  SELECT c.lead_id, c.organization_id, c.meta_lead_id, c.event_name, b.asset_id, b.dataset_id, c.email, c.phone
  FROM cand c
  JOIN public.meta_asset_bindings b
    ON b.organization_id = c.organization_id AND b.asset_type = 'ad_account' AND b.status = 'active'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.meta_signals_sent s WHERE s.lead_id = c.lead_id AND s.event_name = c.event_name
  )
  ORDER BY c.lead_id, c.rnk
  LIMIT 500;
$function$
;

-- ── Guardas ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_master uuid; v_org uuid; v_vel jsonb; v_ana jsonb; v_resto integer;
BEGIN
  -- Nenhuma das três pode continuar decidindo desfecho por papel de etapa.
  SELECT count(*) INTO v_resto FROM pg_proc p
   WHERE p.prokind = 'f'
     AND p.proname IN ('get_pipeline_velocity', 'get_analytics_pipeline_metrics',
                       'get_pending_meta_conversion_signals')
     AND pg_get_functiondef(p.oid) ~ 'stage_role\s*(=|IN)\s*''?(won|lost|\()'
     -- `NOT IN ('won','lost')` some junto: a exclusão de terminais também
     -- passou a perguntar ao negócio.
  ;
  IF v_resto > 0 THEN
    RAISE EXCEPTION '% funcao(oes) ainda decidem desfecho por stage_role', v_resto;
  END IF;

  -- As três precisam CONTINUAR respondendo. Guarda contra erro de sintaxe que
  -- só apareceria no primeiro uso real.
  --
  -- Usuário MEMBRO da org, não master: `resolve_org_for_rpc` resolve por
  -- vínculo, e um master que não pertence à org devolve NULL — a função então
  -- retorna `{}` e a guarda reprovaria por um motivo que não é o dela.
  SELECT tm.organization_id, tm.user_id INTO v_org, v_master
    FROM public.team_members tm
   WHERE tm.user_id IS NOT NULL AND tm.is_active
     AND EXISTS (SELECT 1 FROM public.deals d
                  WHERE d.organization_id = tm.organization_id AND d.outcome IN ('won','lost'))
     AND EXISTS (SELECT 1 FROM public.pipelines p
                  WHERE p.organization_id = tm.organization_id AND p.slug = 'propostas')
   LIMIT 1;
  -- Banco vazio não tem o que exercitar. Ver a nota em 20270916000020: pular
  -- por falta de fixture é diferente de aprovar uma sonda que foi barrada.
  IF v_org IS NULL THEN
    RAISE NOTICE 'sem org com membro, funil propostas e negocio fechado — smoke pulado (banco novo?)';
    PERFORM set_config('request.jwt.claims', NULL, true);
    RETURN;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_master, 'role', 'authenticated')::text, true);

  v_vel := public.get_pipeline_velocity('propostas', NULL, NULL, v_org, NULL);
  IF v_vel IS NULL OR NOT (v_vel ? 'num_won') THEN
    RAISE EXCEPTION 'get_pipeline_velocity nao devolveu o shape esperado: %', v_vel;
  END IF;

  v_ana := public.get_analytics_pipeline_metrics(v_org, (now() - interval '90 days')::date, now()::date);
  IF v_ana IS NULL OR NOT (v_ana ? 'pipeline_aging') OR NOT (v_ana ? 'conversion_trends') THEN
    RAISE EXCEPTION 'get_analytics_pipeline_metrics nao devolveu o shape esperado';
  END IF;

  -- Inerte por `meta_asset_bindings` vazia, mas tem de executar sem erro.
  PERFORM * FROM public.get_pending_meta_conversion_signals();

  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;
