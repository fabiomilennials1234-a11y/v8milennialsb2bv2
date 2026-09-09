-- 20270908009000_analytics_por_pipeline_id.sql — SCRUM-631 (W3 · Funil é Funil)
--
-- As 4 RPCs de análise ganham resolução por pipeline_id: funil custom entra
-- nos números. Padrão da 20270908003000 (SCRUM-626): MESMO nome, parâmetro
-- novo `p_pipeline_id uuid DEFAULT NULL` no FIM (parâmetro duplo, não wrapper);
-- `p_pipeline_type` vira ALIAS LEGADO — slug resolvido em `pipelines`
-- (org, slug), sem predicado type='system' (slug é único por org, medido na
-- 626). Lógica interna por pipeline_id + stage_role/position (ADR-0017);
-- nenhum slug de etapa hardcoded sobrevive.
--
-- Mapa RPC (assinaturas velhas → novas; todas DROP + CREATE):
--   get_funnel_conversion(text,tstz,tstz)
--     → get_funnel_conversion(text,tstz,tstz, p_org_id uuid, p_pipeline_id uuid)
--   get_pipeline_velocity(text,tstz,tstz)
--     → get_pipeline_velocity(text,tstz,tstz, p_org_id uuid, p_pipeline_id uuid)
--   get_sales_cycle_analysis(text,tstz,tstz,uuid)
--     → get_sales_cycle_analysis(text,tstz,tstz,uuid, p_pipeline_id uuid)
--   get_analytics_pipeline_metrics(uuid,date,date,text,uuid)
--     → get_analytics_pipeline_metrics(uuid,date,date,text,uuid, p_pipeline_id uuid)
--
-- Fatos medidos em prod 2026-09-02 que sustentam cada decisão:
--   • pipeline_stages: 0 etapas de funil vivo com pipeline_id NULL; 0 etapas
--     onde pipeline_type diverge do slug do funil apontado; 0 (pipeline_id,
--     stage_key) duplicados → trocar (organization_id, pipeline_type) por
--     pipeline_id na seleção de etapas é LOSSLESS.
--   • Funil propostas de sistema: stage_key 'vendido' ↔ stage_role 'won' e
--     'perdido' ↔ 'lost' em 105/105 orgs; 0 entries de propostas com stage_key
--     órfão → velocity por stage_role é byte-a-byte com o legado no propostas.
--   • get_funnel_conversion de prod casa lead_history por metadata->>'to_stage_id',
--     chave que NUNCA foi escrita: 0 eventos casados DESDE SEMPRE — o gráfico
--     "Conversão por Etapa" mostra zero em toda etapa desde que nasceu. As
--     chaves REAIS são to_stage (15.919 eventos, desde 2026-06-10) e
--     pipeline_id (15.282, desde 2026-06-24). A nova versão casa por
--     (metadata->>'pipeline_id', metadata->>'to_stage'): DELTA DELIBERADO —
--     ressuscita uma feature morta (0 → números reais).
--   • get_sales_cycle_analysis filtrava por rótulo textual (pipe_label ILIKE
--     '%WhatsApp%' etc). O produtor atual escreve "no funil Qualificação" →
--     o ILIKE '%WhatsApp%' NÃO casa nenhum evento pós-junho: o filtro legado
--     também já estava morto para dados novos. O hack morre; o filtro passa a
--     ser metadata->>'pipeline_id' (canônico desde 2026-06-24). Eventos
--     anteriores a essa data ficam FORA das visões filtradas por funil
--     (aparecem no recorte "todas as transições", inalterado byte-a-byte).
--   • sale_events cobre só 469 vendas desde 2026-02-23 (31 orgs) → a série
--     mensal 'Proposta → Venda' NÃO pode migrar para o caderno ainda sem
--     colapsar meses antigos. O caderno sale_events segue sendo a única fonte
--     de RECEITA realizada (ADR-0017); aqui a série é CONTAGEM de desfecho e
--     passa a ancorar em COALESCE(closed_at, stage_changed_at) — determinístico
--     — no lugar de updated_at (R4: qualquer toque no card movia a venda de mês).
--   • pipeline_stages.default_probability existe e vale 50 em todas as etapas
--     de prod → o forecast troca a tabela fixa de probabilidade por stage_name
--     (0.70/0.30/0.25/0.15/0.08 + VALUES de 5 slugs) pelo MECANISMO por etapa
--     (default_probability/100), com fallback 0.50. Deltas documentados abaixo.
--
-- Mudanças de semântica (deltas medidos no ensaio scripts/ensaio-scrum631.sh):
--   D-fc  funnel_conversion: total_entered sai de 0 fixo para contagem real.
--   D-vel velocity em funis ≠ propostas: won/lost por stage_role (governado
--         pela W2) no lugar dos slugs 'vendido'/'perdido' — orgs que marcaram
--         won em etapas próprias passam a contar.
--   D-sc  sales_cycle filtrado por funil: id canônico (metadata.pipeline_id)
--         em UNIÃO com o rótulo legado para eventos sem a chave — o produtor
--         só cobre o funil de qualificação hoje (14.933 eventos vs 3 de
--         propostas), então o rótulo segue como fallback de acervo até o
--         produtor cobrir os demais. Efeito líquido medido: recortes crescem
--         (eventos novos do funil de qualificação, cujo rótulo "funil
--         Qualificação" o ILIKE '%WhatsApp%' legado JÁ não casava, voltam ao
--         recorte); nada some. Recorte "todas" permanece byte-a-byte.
--   D-agz pipeline_aging: generalizado para TODOS os funis ativos da org
--         (custom entra). Etapas não-terminais = stage_role NOT IN
--         ('won','lost') — substitui as exclusões por slug de cada pipe
--         ('agendado','esfriou' / 'compareceu','perdido' / 'vendido','perdido').
--         Cartões parados em esfriou/agendado/compareceu passam a ENVELHECER à
--         vista (antes eram ocultados). Âncora: stage_changed_at (tempo NA
--         etapa) no lugar de updated_at (último toque). Rótulo: nome real da
--         etapa; sem filtro de funil, prefixado com o nome do funil.
--   D-fx  weighted_forecast: cobre o funil resolvido (ou todos, sem filtro) —
--         antes só propostas, e SILENCIOSAMENTE descartava negócios em
--         proposta_enviada (etapa fora do VALUES legado). Probabilidade por
--         etapa via default_probability.
--   D-mw  conversion_trends[3] ('Proposta → Venda'): won por stage_role +
--         âncora closed_at/stage_changed_at (ver acima).
--   Byte-a-byte preservado: funnel_stages, stage_analysis, pipeline_total,
--   conversion_trends[0..2], velocity de propostas, sales_cycle sem filtro.
--
-- Atribuição (p_member_id): espelha as colunas que as views legadas projetam
-- de pipeline_entries.metadata (closer_id, responsible_id, sdr_id,
-- pre_sale_responsible_id, sale_responsible_id) — em OR, nunca COALESCE (R5).
--
-- CTEs mortos do corpo legado NÃO restaurados (nunca influenciaram o output):
-- total_leads_val/total_qualified_val/total_attended_val, historical_win_rates
-- (calculado e jamais lido).
--
-- Grants (DROP+CREATE reseta ACL — regra da casa): espelhados de prod,
-- função a função, medidos 2026-09-02:
--   get_funnel_conversion / get_pipeline_velocity / get_sales_cycle_analysis:
--     anon ✓, authenticated ✓, service_role ✓ (anon herdado do passado; a
--     resolução por auth.uid() devolve vazio para anon — superfície mantida
--     idêntica, redução fica para ticket próprio de ACL).
--   get_analytics_pipeline_metrics: authenticated ✓, service_role ✓, anon ✗.
--
-- Sem BEGIN/COMMIT de topo: o CLI embrulha em transação e o ensaio
-- (scripts/ensaio-scrum631.sh) concatena este arquivo numa transação maior.
-- Rollback pareado: supabase/migrations/rollback/20270908009000_*.sql
-- (functiondefs EXATOS de prod, snapshot 2026-09-02, + ACL original).

-- ────────────────────────────────────────────────────────────────────────────
-- §1 · get_funnel_conversion — etapas por pipeline_id; entrada por metadata real
-- ────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_funnel_conversion(text, timestamptz, timestamptz);

CREATE FUNCTION public.get_funnel_conversion(
  p_pipeline_type text DEFAULT NULL,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL,
  p_org_id uuid DEFAULT NULL,
  p_pipeline_id uuid DEFAULT NULL
)
RETURNS TABLE(stage_id uuid, stage_name text, stage_order integer, total_entered bigint, total_current bigint, conversion_rate numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_org_id uuid;
  v_pipeline_id uuid;
BEGIN
  -- resolve_org_for_rpc(NULL) reproduz o lookup legado (primeira org do
  -- team_members por auth.uid()); com p_org_id, exige membership na org pedida.
  v_org_id := public.resolve_org_for_rpc(p_org_id);
  IF v_org_id IS NULL THEN RETURN; END IF;

  -- id é canônico; slug é alias de QUALQUER funil da org (padrão da 626).
  SELECT p.id INTO v_pipeline_id
  FROM public.pipelines p
  WHERE p.organization_id = v_org_id
    AND ((p_pipeline_id IS NOT NULL AND p.id = p_pipeline_id)
      OR (p_pipeline_id IS NULL AND p.slug = p_pipeline_type));
  IF v_pipeline_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH stage_counts AS (
    SELECT
      ps.id AS sid,
      ps.name AS sname,
      ps.position,
      -- Entradas na etapa no período: eventos stage_changed do lead_history
      -- casados por (metadata.pipeline_id, metadata.to_stage) — as chaves que
      -- o produtor REALMENTE escreve (a chave legada to_stage_id nunca
      -- existiu; medido 2026-09-02: 0 eventos casados desde sempre).
      COUNT(DISTINCT lh.lead_id) FILTER (
        WHERE (p_start_date IS NULL OR lh.created_at >= p_start_date)
          AND (p_end_date IS NULL OR lh.created_at <= p_end_date)
      ) AS entered
    FROM public.pipeline_stages ps
    LEFT JOIN public.lead_history lh
      ON lh.organization_id = v_org_id
     AND lh.action = 'stage_changed'
     AND lh.metadata->>'pipeline_id' = v_pipeline_id::text
     AND lh.metadata->>'to_stage' = ps.stage_key
    WHERE ps.pipeline_id = v_pipeline_id
    GROUP BY ps.id, ps.name, ps.position
  )
  SELECT
    sc.sid,
    sc.sname,
    sc.position,
    sc.entered,
    sc.entered,
    CASE
      WHEN LAG(sc.entered) OVER (ORDER BY sc.position) > 0
      THEN ROUND(sc.entered::numeric / LAG(sc.entered) OVER (ORDER BY sc.position) * 100, 1)
      ELSE 100.0
    END AS conv_rate
  FROM stage_counts sc
  ORDER BY sc.position;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_funnel_conversion(text, timestamptz, timestamptz, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_funnel_conversion(text, timestamptz, timestamptz, uuid, uuid) TO anon, authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- §2 · get_pipeline_velocity — desfecho por stage_role; predicado de tipo morre
-- ────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_pipeline_velocity(text, timestamptz, timestamptz);

CREATE FUNCTION public.get_pipeline_velocity(
  p_pipeline_type text DEFAULT NULL,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL,
  p_org_id uuid DEFAULT NULL,
  p_pipeline_id uuid DEFAULT NULL
)
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
    -- Desfecho por stage_role (ADR-0017), não por slug de etapa. Medido:
    -- vendido↔won e perdido↔lost em 105/105 funis propostas → byte-a-byte no
    -- caminho legado; funis com won/lost governados em outras etapas passam a
    -- contar (D-vel).
    SELECT ps.stage_role, (pe.metadata->>'sale_value')::numeric AS sale_value
    FROM public.pipeline_entries pe
    JOIN public.pipeline_stages ps
      ON ps.pipeline_id = pe.pipeline_id
     AND ps.stage_key = pe.stage_key
    WHERE pe.organization_id = v_org_id
      AND pe.pipeline_id = v_pipeline_id
      AND ps.stage_role IN ('won', 'lost')
      AND (p_start_date IS NULL OR pe.created_at >= p_start_date)
      AND (p_end_date IS NULL OR pe.created_at <= p_end_date)
  )
  SELECT jsonb_build_object(
    'num_won', COUNT(*) FILTER (WHERE cd.stage_role = 'won'),
    'total_closed', COUNT(*),
    'win_rate', CASE WHEN COUNT(*) > 0
      THEN ROUND((COUNT(*) FILTER (WHERE cd.stage_role = 'won'))::numeric / COUNT(*) * 100, 1)
      ELSE 0 END,
    'avg_deal_value', ROUND(COALESCE(AVG(cd.sale_value) FILTER (WHERE cd.stage_role = 'won'), 0)::numeric, 2)
  ) INTO v_result
  FROM closed_deals cd;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_pipeline_velocity(text, timestamptz, timestamptz, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pipeline_velocity(text, timestamptz, timestamptz, uuid, uuid) TO anon, authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- §3 · get_sales_cycle_analysis — o hack pipe_label ILIKE morre
-- ────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_sales_cycle_analysis(text, timestamptz, timestamptz, uuid);

CREATE FUNCTION public.get_sales_cycle_analysis(
  p_pipeline_type text DEFAULT NULL,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL,
  p_org_id uuid DEFAULT NULL,
  p_pipeline_id uuid DEFAULT NULL
)
RETURNS TABLE(from_stage text, to_stage text, avg_hours numeric, median_hours numeric, transition_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
  v_pipeline_id uuid;
  v_pipe_slug text;
  v_pipe_name text;
  v_filtered boolean;
BEGIN
  v_org_id := public.resolve_org_for_rpc(p_org_id);
  IF v_org_id IS NULL THEN RETURN; END IF;

  v_filtered := (p_pipeline_id IS NOT NULL OR p_pipeline_type IS NOT NULL);
  IF v_filtered THEN
    SELECT p.id, p.slug, p.name INTO v_pipeline_id, v_pipe_slug, v_pipe_name
    FROM public.pipelines p
    WHERE p.organization_id = v_org_id
      AND ((p_pipeline_id IS NOT NULL AND p.id = p_pipeline_id)
        OR (p_pipeline_id IS NULL AND p.slug = p_pipeline_type));
    -- Alvo pedido e inexistente: vazio (nunca degrada para "todas").
    IF v_pipeline_id IS NULL THEN RETURN; END IF;
  END IF;

  RETURN QUERY
  WITH ev AS (
    SELECT lh.lead_id, lh.created_at,
      -- to_s idêntico ao legado (metadata.to_stage com fallback na descrição).
      COALESCE(NULLIF(lh.metadata->>'to_stage',''), substring(lh.description from 'para "([^"]+)"')) AS to_s,
      -- Funil do evento, em DUAS gerações (medido 2026-09-02):
      --   1. metadata.pipeline_id — canônico, escrito desde 2026-06-24 (15.282
      --      eventos; quase todos do funil de qualificação: o produtor ainda
      --      não cobre propostas/confirmação — 3 e 1 eventos).
      --   2. rótulo textual (legado) — só para eventos SEM a chave canônica.
      NULLIF(lh.metadata->>'pipeline_id', '')::uuid AS ev_pipeline_id,
      COALESCE(NULLIF(lh.metadata->>'pipeline',''), substring(lh.description from '(?:no|na) ((?:Funil|Pipe) .+)$')) AS pipe_label
    FROM public.lead_history lh
    WHERE lh.organization_id = v_org_id
      AND lh.action IN ('stage_changed', 'proposal_status_changed')
      AND (p_start_date IS NULL OR lh.created_at >= p_start_date)
      AND (p_end_date IS NULL OR lh.created_at <= p_end_date)
  ),
  seq AS (
    SELECT e.to_s, e.ev_pipeline_id, e.pipe_label,
      LAG(e.to_s) OVER w AS from_s,
      EXTRACT(EPOCH FROM (e.created_at - LAG(e.created_at) OVER w)) / 3600.0 AS hours_diff
    FROM ev e
    WHERE e.to_s IS NOT NULL
    WINDOW w AS (PARTITION BY e.lead_id ORDER BY e.created_at)
  )
  SELECT s.from_s, s.to_s, ROUND(AVG(s.hours_diff)::numeric, 1),
    ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.hours_diff))::numeric, 1), COUNT(*)
  FROM seq s
  WHERE s.from_s IS NOT NULL AND s.from_s <> s.to_s AND s.hours_diff IS NOT NULL AND s.hours_diff > 0
    -- Filtro por funil: id canônico; rótulo legado APENAS para eventos sem a
    -- chave (o hack pipe_label ILIKE deixa de ser a via principal — vira
    -- fallback de acervo, e some sozinho conforme o produtor cobre os funis).
    AND (v_pipeline_id IS NULL
      OR s.ev_pipeline_id = v_pipeline_id
      OR (s.ev_pipeline_id IS NULL AND s.pipe_label IS NOT NULL AND (
            s.pipe_label ILIKE '%' || v_pipe_name || '%'
         OR s.pipe_label ILIKE '%' || v_pipe_slug || '%'
         OR (v_pipe_slug = 'whatsapp'    AND s.pipe_label ILIKE '%WhatsApp%')
         OR (v_pipe_slug = 'confirmacao' AND s.pipe_label ILIKE '%Confirma%')
         OR (v_pipe_slug = 'propostas'   AND s.pipe_label ILIKE '%Proposta%'))))
  GROUP BY s.from_s, s.to_s ORDER BY COUNT(*) DESC LIMIT 12;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_sales_cycle_analysis(text, timestamptz, timestamptz, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sales_cycle_analysis(text, timestamptz, timestamptz, uuid, uuid) TO anon, authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- §4 · get_analytics_pipeline_metrics — aging e forecast generalizados;
--      jornada (funnel_stages/stage_analysis/trends[0..2]) byte-a-byte
-- ────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_analytics_pipeline_metrics(uuid, date, date, text, uuid);

CREATE FUNCTION public.get_analytics_pipeline_metrics(
  p_org_id uuid,
  p_start_date date,
  p_end_date date,
  p_pipeline_type text DEFAULT NULL,
  p_member_id uuid DEFAULT NULL,
  p_pipeline_id uuid DEFAULT NULL
)
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
  won_leads AS (
    SELECT DISTINCT pp.lead_id
    FROM pipe_propostas pp
    JOIN leads_created lc ON lc.lead_id = pp.lead_id
    WHERE pp.organization_id = p_org_id
      AND pp.status = 'vendido'
      AND (p_member_id IS NULL OR pp.closer_id = p_member_id OR pp.responsible_id = p_member_id)
  ),
  won_count AS (
    SELECT COUNT(*) AS cnt FROM won_leads
  ),
  propostas_lost AS (
    SELECT COUNT(DISTINCT pp.lead_id) AS cnt
    FROM pipe_propostas pp
    JOIN leads_created lc ON lc.lead_id = pp.lead_id
    WHERE pp.organization_id = p_org_id
      AND pp.status = 'perdido'
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
  -- Estado atual, sem filtro de data (como o legado). Etapa não-terminal =
  -- stage_role fora de won/lost (ADR-0017) — substitui as exclusões por slug
  -- de cada pipe. Âncora: stage_changed_at = tempo NA etapa (o legado usava
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
    WHERE pe.organization_id = p_org_id
      AND (NOT v_filtered OR pe.pipeline_id = v_pipeline_id)
      AND COALESCE(ps.stage_role, 'open') NOT IN ('won', 'lost')
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
  -- fechada (etapas won/lost ficam de fora por stage_role).
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
    WHERE pe.organization_id = p_org_id
      AND (NOT v_filtered OR pe.pipeline_id = v_pipeline_id)
      AND COALESCE(ps.stage_role, 'open') NOT IN ('won', 'lost')
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
  -- D-mw: 'vendido no mês' por stage_role='won' do funil propostas, ancorado
  -- em COALESCE(closed_at, stage_changed_at) — determinístico. O legado
  -- ancorava em updated_at: qualquer toque posterior no card MOVIA a venda de
  -- mês (R4/ADR-0017). Atribuição espelha a view (closer_id/responsible_id).
  monthly_won AS (
    SELECT
      m.month_label,
      COUNT(DISTINCT w.lead_id) AS won_cnt
    FROM months_series m
    LEFT JOIN (
      SELECT pe.lead_id,
             COALESCE(pe.closed_at, pe.stage_changed_at) AS won_at,
             pe.metadata
      FROM pipeline_entries pe
      JOIN pipelines pip
        ON pip.id = pe.pipeline_id
       AND pip.organization_id = p_org_id
       AND pip.slug = 'propostas'
      JOIN pipeline_stages ps
        ON ps.pipeline_id = pe.pipeline_id
       AND ps.stage_key = pe.stage_key
       AND ps.stage_role = 'won'
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
$function$;

REVOKE ALL ON FUNCTION public.get_analytics_pipeline_metrics(uuid, date, date, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_analytics_pipeline_metrics(uuid, date, date, text, uuid, uuid) TO authenticated, service_role;
