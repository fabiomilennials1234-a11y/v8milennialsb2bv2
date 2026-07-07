-- 20270302000080_productivity_canonical.sql
--
-- Issue #1000 · PRD #986 · ADR-0017 §2-5,§8 / ADR-0013 — PRODUTIVIDADE canônica (SP-3).
--
-- O QUE FAZ: redefine (CREATE OR REPLACE, assinatura e shape INTACTOS) as três
-- RPCs de produtividade activity-in-period para que a dimensão `vendido` leia SÓ
-- o caderno append-only `sale_events` (#993), matando os 3 vícios que a RPC
-- pós-auditoria get_productivity_activity_by_seller (20270201000000, 2026-07-03)
-- REINTRODUZIU no bloco de venda:
--   · R3 (predicado de funil system cega custom pipelines) → sale_events NÃO tem
--     predicado de tipo de funil; venda em funil custom conta igual (caderno funil-agnóstico).
--   · R4 (âncora zoo COALESCE(lead_history.min, closed_at, stage_changed_at)) → UMA
--     âncora: sale_events.sold_at (momento do registro, imutável, ADR-0017 §4).
--   · R5 (atribuição multi-chave: fallback encadeado sale_responsible/closer/metadata)
--     → UMA chave canônica: sale_events.sale_responsible_id (snapshot no evento).
-- Além disso, `vendido` passa a ser LÍQUIDO DE ESTORNO (anti-join por
-- reversed_event_id, ADR-0017 §3): venda que saiu de `won` some da contagem.
--
-- SEMÂNTICA ACTIVITY-IN-PERIOD PRESERVADA (ADR-0013): cada contagem é keyed pela
-- DATA DA AÇÃO, não pela criação do lead.
--   · novos_leads         — leads.created_at (a criação do lead É a ação; atribuição
--                           = responsável, fallback legado sdr — modelo de posse do
--                           lead, NÃO é métrica de venda; sancionado via metric-lint-allow).
--   · reunioes_marcadas   — meeting_events 'meeting_booked' por occurred_at (ADR-0007,
--                           já-correto; ledger funil-agnóstico, atribuição pré-vendas).
--   · reunioes_realizadas — meeting_events 'meeting_held' por meeting_date (ADR-0007).
--   · vendido             — sale_events 'sale' por sold_at, líquido de estorno,
--                           atribuição por sale_responsible_id único. NOVO nesta fatia.
--
-- CORTE DE PERÍODO: a assinatura é mantida em [p_from, p_to] timestamptz (fechado,
--   idêntico às outras dimensões desta RPC) para backward-compat total com o hook
--   useProductivityActivity.ts (que passa ISO strings) — a fronteira org-tz é
--   responsabilidade de quem calcula os bounds (o app resolve o mês). A ÂNCORA
--   canônica é sold_at (o instante absoluto do registro), como em get_sales_metrics.
--   Consumidores que migrarem para período NOMEADO envolvem metric_period_bounds()
--   por fora; o anchor sold_at já é o correto e não muda.
--
-- Guard: PERFORM assert_org_access(p_org_id) (inalterado). SECURITY DEFINER.
--
-- Motor antigo preservado: os corpos legados (com R3/R4/R5) vivem nas snapshots
-- ADR-0018 (20270301000005/09/10) e no rollback desta migration — caminho de
-- reversão até o portão de reconciliação (#1000 reconcile + ADR-0017 §8).
--
-- Rollback: supabase/migrations/rollback/20270302000080_productivity_canonical.sql
-- Testes:   supabase/tests/productivity_canonical_test.sql (pgTAP, wired no run.sh)
-- Reconc.:  scripts/reconcile-productivity-1000.sql (× réplica fiel do bloco legado)

-- ============================================================================
-- 1. get_productivity_activity — 4 contagens, org-wide ou 1 vendedor
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_productivity_activity(
  p_org_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_seller uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_novos       int := 0;
  v_marcadas    int := 0;
  v_realizadas  int := 0;
  v_vendido     int := 0;
BEGIN
  PERFORM public.assert_org_access(p_org_id);

  -- Novos leads — by created_at. Atribuição = responsável (fallback legado sdr).
  SELECT count(*) INTO v_novos
  FROM public.leads l
  WHERE l.organization_id = p_org_id
    AND l.deleted_at IS NULL
    AND l.created_at >= p_from
    AND l.created_at <= p_to
    AND (p_seller IS NULL OR COALESCE(l.responsible_id, l.sdr_id) = p_seller); -- metric-lint-allow: posse do LEAD (não venda) — responsible/sdr é o modelo legado de atribuição de lead, ADR-0013

  -- Reuniões Marcadas — meeting_booked by occurred_at. Atribuição = Pré-vendas.
  SELECT count(*) INTO v_marcadas
  FROM public.meeting_events me
  WHERE me.organization_id = p_org_id
    AND me.event_type = 'meeting_booked'
    AND me.occurred_at >= p_from
    AND me.occurred_at <= p_to
    AND (p_seller IS NULL OR me.pre_sale_responsible_id = p_seller);

  -- Reuniões Realizadas — meeting_held by meeting_date. Atribuição = Pré-vendas.
  SELECT count(*) INTO v_realizadas
  FROM public.meeting_events me
  WHERE me.organization_id = p_org_id
    AND me.event_type = 'meeting_held'
    AND me.meeting_date IS NOT NULL
    AND me.meeting_date >= p_from
    AND me.meeting_date <= p_to
    AND (p_seller IS NULL OR me.pre_sale_responsible_id = p_seller);

  -- Vendido — SÓ sale_events (#993), líquido de estorno (anti-join §3), âncora
  -- sold_at (§4), atribuição sale_responsible_id único (§5). SEM predicado de
  -- funil system (custom pipelines contam — R3). Mata R3/R4/R5 reintroduzidos em 20270201000000.
  SELECT count(*) INTO v_vendido
  FROM public.sale_events w
  WHERE w.organization_id = p_org_id
    AND w.event_type = 'sale'
    AND w.sold_at >= p_from
    AND w.sold_at <= p_to
    AND (p_seller IS NULL OR w.sale_responsible_id = p_seller)
    AND NOT EXISTS (
      SELECT 1 FROM public.sale_events r
      WHERE r.event_type = 'sale_reversed'
        AND r.reversed_event_id = w.id
    );

  RETURN jsonb_build_object(
    'novos_leads',         v_novos,
    'reunioes_marcadas',   v_marcadas,
    'reunioes_realizadas', v_realizadas,
    'vendido',             v_vendido,
    'from',                p_from,
    'to',                  p_to,
    'seller',              p_seller
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_productivity_activity(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_productivity_activity(uuid, timestamptz, timestamptz, uuid) TO authenticated, service_role;

-- ============================================================================
-- 2. get_productivity_activity_leads — drill por-lead atrás de uma contagem
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_productivity_activity_leads(
  p_org_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_count_type text,
  p_seller uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rows jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.assert_org_access(p_org_id);

  IF p_count_type = 'novos_leads' THEN
    SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'action_at') DESC), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT jsonb_build_object(
               'lead_id',     l.id,
               'lead_name',   l.name,
               'company',     l.company,
               'seller_id',   tm.id,
               'seller_name', tm.name,
               'action_at',   l.created_at
             ) AS r
      FROM public.leads l
      LEFT JOIN public.team_members tm ON tm.id = COALESCE(l.responsible_id, l.sdr_id) -- metric-lint-allow: posse do LEAD (não venda), ADR-0013
      WHERE l.organization_id = p_org_id
        AND l.deleted_at IS NULL
        AND l.created_at >= p_from
        AND l.created_at <= p_to
        AND (p_seller IS NULL OR COALESCE(l.responsible_id, l.sdr_id) = p_seller) -- metric-lint-allow: posse do LEAD (não venda), ADR-0013
    ) q;

  ELSIF p_count_type = 'reunioes_marcadas' THEN
    SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'action_at') DESC), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT jsonb_build_object(
               'lead_id',     l.id,
               'lead_name',   l.name,
               'company',     l.company,
               'seller_id',   tm.id,
               'seller_name', tm.name,
               'action_at',   me.occurred_at
             ) AS r
      FROM public.meeting_events me
      JOIN public.leads l ON l.id = me.lead_id
      LEFT JOIN public.team_members tm ON tm.id = me.pre_sale_responsible_id
      WHERE me.organization_id = p_org_id
        AND me.event_type = 'meeting_booked'
        AND me.occurred_at >= p_from
        AND me.occurred_at <= p_to
        AND (p_seller IS NULL OR me.pre_sale_responsible_id = p_seller)
    ) q;

  ELSIF p_count_type = 'reunioes_realizadas' THEN
    SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'action_at') DESC), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT jsonb_build_object(
               'lead_id',     l.id,
               'lead_name',   l.name,
               'company',     l.company,
               'seller_id',   tm.id,
               'seller_name', tm.name,
               'action_at',   me.meeting_date
             ) AS r
      FROM public.meeting_events me
      JOIN public.leads l ON l.id = me.lead_id
      LEFT JOIN public.team_members tm ON tm.id = me.pre_sale_responsible_id
      WHERE me.organization_id = p_org_id
        AND me.event_type = 'meeting_held'
        AND me.meeting_date IS NOT NULL
        AND me.meeting_date >= p_from
        AND me.meeting_date <= p_to
        AND (p_seller IS NULL OR me.pre_sale_responsible_id = p_seller)
    ) q;

  ELSIF p_count_type = 'vendido' THEN
    -- Drill de venda lê o caderno sale_events (líquido de estorno, sold_at,
    -- sale_responsible_id único). Uma linha por venda não-estornada no período.
    SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'action_at') DESC), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT jsonb_build_object(
               'lead_id',     l.id,
               'lead_name',   l.name,
               'company',     l.company,
               'seller_id',   tm.id,
               'seller_name', tm.name,
               'action_at',   w.sold_at
             ) AS r
      FROM public.sale_events w
      JOIN public.leads l ON l.id = w.lead_id
      LEFT JOIN public.team_members tm ON tm.id = w.sale_responsible_id
      WHERE w.organization_id = p_org_id
        AND w.event_type = 'sale'
        AND w.sold_at >= p_from
        AND w.sold_at <= p_to
        AND (p_seller IS NULL OR w.sale_responsible_id = p_seller)
        AND NOT EXISTS (
          SELECT 1 FROM public.sale_events rr
          WHERE rr.event_type = 'sale_reversed'
            AND rr.reversed_event_id = w.id
        )
    ) q;

  ELSE
    RAISE EXCEPTION 'invalid p_count_type: %', p_count_type USING ERRCODE = 'P0001';
  END IF;

  RETURN v_rows;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_productivity_activity_leads(uuid, timestamptz, timestamptz, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_productivity_activity_leads(uuid, timestamptz, timestamptz, text, uuid) TO authenticated, service_role;

-- ============================================================================
-- 3. get_productivity_activity_by_seller — placar POR VENDEDOR (aba Performance)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_productivity_activity_by_seller(
  p_org_id uuid,
  p_from   timestamptz,
  p_to     timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
BEGIN
  PERFORM public.assert_org_access(p_org_id);

  WITH members AS (
    SELECT tm.id, tm.name, tm.metric_type::text AS metric_type
    FROM public.team_members tm
    WHERE tm.organization_id = p_org_id
      AND tm.is_active = true
  ),
  marcadas AS (
    SELECT me.pre_sale_responsible_id AS sid, count(*) AS c
    FROM public.meeting_events me
    WHERE me.organization_id = p_org_id
      AND me.event_type = 'meeting_booked'
      AND me.occurred_at >= p_from AND me.occurred_at <= p_to
      AND me.pre_sale_responsible_id IS NOT NULL
    GROUP BY 1
  ),
  realizadas AS (
    SELECT me.pre_sale_responsible_id AS sid, count(*) AS c
    FROM public.meeting_events me
    WHERE me.organization_id = p_org_id
      AND me.event_type = 'meeting_held'
      AND me.meeting_date IS NOT NULL
      AND me.meeting_date >= p_from AND me.meeting_date <= p_to
      AND me.pre_sale_responsible_id IS NOT NULL
    GROUP BY 1
  ),
  novos AS (
    SELECT COALESCE(l.responsible_id, l.sdr_id) AS sid, count(*) AS c -- metric-lint-allow: posse do LEAD (não venda), ADR-0013
    FROM public.leads l
    WHERE l.organization_id = p_org_id
      AND l.deleted_at IS NULL
      AND l.created_at >= p_from AND l.created_at <= p_to
      AND COALESCE(l.responsible_id, l.sdr_id) IS NOT NULL -- metric-lint-allow: posse do LEAD (não venda), ADR-0013
    GROUP BY 1
  ),
  vendido AS (
    -- SÓ sale_events (#993): líquido de estorno (§3), âncora sold_at (§4),
    -- atribuição sale_responsible_id único (§5), SEM predicado de funil system
    -- (custom pipelines contam — R3). Mata R3/R4/R5 reintroduzidos em 20270201000000.
    SELECT w.sale_responsible_id AS sid, count(*) AS c
    FROM public.sale_events w
    WHERE w.organization_id = p_org_id
      AND w.event_type = 'sale'
      AND w.sold_at >= p_from AND w.sold_at <= p_to
      AND w.sale_responsible_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.sale_events r
        WHERE r.event_type = 'sale_reversed'
          AND r.reversed_event_id = w.id
      )
    GROUP BY 1
  )
  SELECT COALESCE(
    jsonb_agg(
      to_jsonb(t)
      ORDER BY t.reunioes_realizadas DESC, t.reunioes_marcadas DESC, t.vendido DESC
    ),
    '[]'::jsonb
  )
  INTO result
  FROM (
    SELECT
      m.id                        AS seller_id,
      m.name                      AS seller_name,
      m.metric_type               AS metric_type,
      COALESCE(n.c, 0)::int       AS novos_leads,
      COALESCE(mk.c, 0)::int      AS reunioes_marcadas,
      COALESCE(r.c, 0)::int       AS reunioes_realizadas,
      COALESCE(v.c, 0)::int       AS vendido
    FROM members m
    LEFT JOIN marcadas   mk ON mk.sid = m.id
    LEFT JOIN realizadas r  ON r.sid  = m.id
    LEFT JOIN novos      n  ON n.sid  = m.id
    LEFT JOIN vendido    v  ON v.sid  = m.id
    WHERE COALESCE(mk.c,0) + COALESCE(r.c,0) + COALESCE(v.c,0) + COALESCE(n.c,0) > 0
  ) t;

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_productivity_activity_by_seller(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_productivity_activity_by_seller(uuid, timestamptz, timestamptz) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_productivity_activity_by_seller(uuid, timestamptz, timestamptz) IS
  'ADR-0013 activity-in-period / ADR-0017 §2-5 / #1000 — placar por vendedor. '
  'vendido lê SÓ sale_events (líquido de estorno, âncora sold_at, atribuição '
  'sale_responsible_id única, sem type=''system''): mata R3/R4/R5 reintroduzidos '
  'na RPC de 2026-07-03. reuniões via meeting_events (ADR-0007); novos por created_at.';
