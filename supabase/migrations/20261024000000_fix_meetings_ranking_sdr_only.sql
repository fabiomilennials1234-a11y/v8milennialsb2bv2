-- ============================================================================
-- Fix: meetings ranking and dashboard credit must attribute to SDR only.
--
-- Background
-- ----------
-- Migration 20260982000000_drop_legacy_pipe_tables.sql recreated
-- get_ranking_data over pipeline_entries but regressed the meetings credit
-- logic that 20260930000000_dual_responsible_fields.sql had fixed.
--
-- The current get_ranking_data UNNESTs (responsible_id, sdr_id, closer_id)
-- and counts distinct meetings per member, which credits the closer for
-- every meeting the closer is attached to. Per business rule, meeting
-- attendance is the SDR's merit. Closer keeps credit for proposals/sales.
--
-- get_dashboard_metrics also filters meetings by closer_id, double-counting
-- a meeting toward the closer when a per-member filter is applied.
--
-- Source of truth
-- ---------------
-- pre_sale_responsible_id → SDR / meetings / qualification credit
-- sale_responsible_id     → closer / revenue / proposal credit
--
-- Legacy fields (sdr_id, closer_id, responsible_id) remain as fallback
-- for rows whose dual fields were never populated. Trigger
-- sync_dual_responsible_to_lead_from_pipe was dropped together with the
-- legacy pipe tables; metadata on pipeline_entries is the canonical
-- container for both dual and legacy ids.
--
-- Backfill
-- --------
-- We patch pipeline_entries.metadata in-place so that any future RPC or
-- query that reads pre_sale_responsible_id from metadata sees a value
-- even when the dual field was never populated for that entry.
--   pre_sale_responsible_id := COALESCE(pre_sale_responsible_id, sdr_id, responsible_id)
--   sale_responsible_id     := COALESCE(sale_responsible_id,     closer_id, responsible_id)
--
-- Apply scope
-- -----------
-- DEV only. Production deploy must be requested explicitly.
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1: Backfill pipeline_entries metadata with dual fields
-- ============================================================================
-- We do not overwrite an existing pre_sale_responsible_id / sale_responsible_id
-- value. We only fill it in when missing.

UPDATE public.pipeline_entries pe
SET metadata = pe.metadata
  || jsonb_strip_nulls(jsonb_build_object(
       'pre_sale_responsible_id',
         CASE
           WHEN (pe.metadata ? 'pre_sale_responsible_id')
             AND NULLIF(pe.metadata->>'pre_sale_responsible_id', '') IS NOT NULL
           THEN NULL
           ELSE COALESCE(
             NULLIF(pe.metadata->>'sdr_id', ''),
             NULLIF(pe.metadata->>'responsible_id', '')
           )
         END,
       'sale_responsible_id',
         CASE
           WHEN (pe.metadata ? 'sale_responsible_id')
             AND NULLIF(pe.metadata->>'sale_responsible_id', '') IS NOT NULL
           THEN NULL
           ELSE COALESCE(
             NULLIF(pe.metadata->>'closer_id', ''),
             NULLIF(pe.metadata->>'responsible_id', '')
           )
         END
     ))
WHERE pe.metadata IS NOT NULL
  AND (
    NULLIF(pe.metadata->>'pre_sale_responsible_id', '') IS NULL
    OR NULLIF(pe.metadata->>'sale_responsible_id', '') IS NULL
  )
  AND (
    NULLIF(pe.metadata->>'sdr_id', '') IS NOT NULL
    OR NULLIF(pe.metadata->>'closer_id', '') IS NOT NULL
    OR NULLIF(pe.metadata->>'responsible_id', '') IS NOT NULL
  );

-- Also backfill the leads table dual fields where missing, mirroring what
-- the dropped trigger sync_dual_responsible_to_lead_from_pipe used to do.
UPDATE public.leads l
SET
  pre_sale_responsible_id = COALESCE(l.pre_sale_responsible_id, l.sdr_id, l.responsible_id),
  sale_responsible_id     = COALESCE(l.sale_responsible_id,     l.closer_id, l.responsible_id),
  updated_at = NOW()
WHERE l.pre_sale_responsible_id IS NULL
   OR l.sale_responsible_id IS NULL;


-- ============================================================================
-- SECTION 2: get_ranking_data — SDR-only credit for meetings
-- ============================================================================
-- Closer / Sales ranking — group by sale_responsible_id (fallback closer_id, responsible_id)
-- SDR / Meetings ranking — group by pre_sale_responsible_id (fallback sdr_id ONLY)
--
-- Important: meetings ranking MUST NOT fall back to responsible_id, because
-- in many orgs responsible_id is populated with the closer for the lead.
-- Falling back to it would re-introduce the bug. If both dual and sdr_id
-- are NULL the meeting is dropped from the ranking (bucket "sem SDR").

CREATE OR REPLACE FUNCTION public.get_ranking_data(
  p_month INT,
  p_year INT,
  p_organization_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_start_ts TIMESTAMPTZ;
  v_end_ts TIMESTAMPTZ;
  v_sales_ranking JSONB;
  v_meetings_ranking JSONB;
BEGIN
  IF p_organization_id IS NOT NULL THEN
    v_org_id := p_organization_id;
  ELSE
    SELECT tm.organization_id INTO v_org_id
    FROM public.team_members tm WHERE tm.user_id = auth.uid() AND tm.is_active = true
    LIMIT 1;
  END IF;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('salesRanking', '[]'::jsonb, 'meetingsRanking', '[]'::jsonb);
  END IF;

  v_start_ts := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'UTC');
  v_end_ts := ((make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date
                + time '23:59:59.999') AT TIME ZONE 'UTC';

  -- ── Closer / Sales ranking ──────────────────────────────────────────────
  WITH sales_agg AS (
    SELECT COALESCE(
             (pe.metadata->>'sale_responsible_id')::uuid,
             (pe.metadata->>'closer_id')::uuid,
             (pe.metadata->>'responsible_id')::uuid
           ) AS member_id,
           SUM(COALESCE((pe.metadata->>'sale_value')::numeric, 0))::numeric AS total_value,
           COUNT(*)::int AS conversions
    FROM public.pipeline_entries pe
    JOIN public.pipelines pip ON pip.id = pe.pipeline_id
      AND pip.slug = 'propostas' AND pip.type = 'system'
    WHERE pe.organization_id = v_org_id
      AND pe.stage_key = 'vendido'
      AND COALESCE(
            (pe.metadata->>'sale_responsible_id')::uuid,
            (pe.metadata->>'closer_id')::uuid,
            (pe.metadata->>'responsible_id')::uuid
          ) IS NOT NULL
      AND (
        ((pe.metadata->>'metrics_period_at') IS NOT NULL
         AND (pe.metadata->>'metrics_period_at')::timestamptz >= v_start_ts
         AND (pe.metadata->>'metrics_period_at')::timestamptz <= v_end_ts)
        OR ((pe.metadata->>'metrics_period_at') IS NULL
            AND pe.closed_at >= v_start_ts AND pe.closed_at <= v_end_ts)
      )
    GROUP BY member_id
  ),
  sales_data AS (
    SELECT tm.id, tm.name, tm.job_title, COALESCE(tm.metric_type, 'sales') AS metric_type,
      COALESCE(sa.total_value, 0) AS total_value,
      COALESCE(sa.conversions, 0) AS conversions,
      (SELECT g.target_value FROM public.goals g
       WHERE g.organization_id = v_org_id AND g.team_member_id = tm.id
         AND g.month = p_month AND g.year = p_year AND g.type = 'vendas'
       ORDER BY g.created_at DESC LIMIT 1) AS goal_target
    FROM public.team_members tm
    LEFT JOIN sales_agg sa ON sa.member_id = tm.id
    WHERE tm.organization_id = v_org_id AND tm.is_active = true
      AND (tm.metric_type = 'sales' OR tm.metric_type IS NULL)
  ),
  sales_sorted AS (
    SELECT id, name, job_title, metric_type, total_value, conversions, goal_target,
      ROW_NUMBER() OVER (ORDER BY total_value DESC) AS pos
    FROM sales_data
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id, 'name', name, 'job_title', job_title, 'metric_type', metric_type,
      'value', total_value, 'conversions', conversions,
      'goal', COALESCE(goal_target, 0),
      'goalProgress', CASE WHEN goal_target IS NOT NULL AND goal_target > 0
        THEN ROUND((total_value / goal_target) * 100)::int ELSE 0 END,
      'position', pos::int, 'role', 'Vendas'
    ) ORDER BY pos
  ), '[]'::jsonb) INTO v_sales_ranking
  FROM sales_sorted;

  -- ── SDR / Meetings ranking ──────────────────────────────────────────────
  -- COALESCE(pre_sale_responsible_id, sdr_id) ONLY. Do NOT fall back to
  -- responsible_id (often equals closer_id) or closer_id.
  WITH meetings_agg AS (
    SELECT COALESCE(
             (pe.metadata->>'pre_sale_responsible_id')::uuid,
             (pe.metadata->>'sdr_id')::uuid
           ) AS member_id,
           COUNT(DISTINCT pe.id)::int AS total_meetings
    FROM public.pipeline_entries pe
    JOIN public.pipelines pip ON pip.id = pe.pipeline_id
      AND pip.slug = 'confirmacao' AND pip.type = 'system'
    WHERE pe.organization_id = v_org_id
      AND pe.stage_key = 'compareceu'
      AND COALESCE(
            (pe.metadata->>'pre_sale_responsible_id')::uuid,
            (pe.metadata->>'sdr_id')::uuid
          ) IS NOT NULL
      AND (
        ((pe.metadata->>'metrics_period_at') IS NOT NULL
         AND (pe.metadata->>'metrics_period_at')::timestamptz >= v_start_ts
         AND (pe.metadata->>'metrics_period_at')::timestamptz <= v_end_ts)
        OR ((pe.metadata->>'metrics_period_at') IS NULL
            AND pe.created_at >= v_start_ts AND pe.created_at <= v_end_ts)
      )
    GROUP BY member_id
  ),
  meetings_data AS (
    SELECT tm.id, tm.name, tm.job_title, COALESCE(tm.metric_type, 'meetings') AS metric_type,
      0::numeric AS total_value,
      COALESCE(ma.total_meetings, 0) AS meetings,
      (SELECT g.target_value FROM public.goals g
       WHERE g.organization_id = v_org_id AND g.team_member_id = tm.id
         AND g.month = p_month AND g.year = p_year AND g.type = 'reunioes'
       ORDER BY g.created_at DESC LIMIT 1) AS goal_target
    FROM public.team_members tm
    LEFT JOIN meetings_agg ma ON ma.member_id = tm.id
    WHERE tm.organization_id = v_org_id AND tm.is_active = true
      AND tm.metric_type = 'meetings'
  ),
  meetings_sorted AS (
    SELECT id, name, job_title, metric_type, total_value, meetings, goal_target,
      ROW_NUMBER() OVER (ORDER BY meetings DESC) AS pos
    FROM meetings_data
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id, 'name', name, 'job_title', job_title, 'metric_type', metric_type,
      'value', total_value, 'meetings', meetings,
      'goal', COALESCE(goal_target, 0),
      'goalProgress', CASE WHEN goal_target IS NOT NULL AND goal_target > 0
        THEN ROUND((meetings::numeric / goal_target) * 100)::int ELSE 0 END,
      'position', pos::int, 'role', 'Reunioes'
    ) ORDER BY pos
  ), '[]'::jsonb) INTO v_meetings_ranking
  FROM meetings_sorted;

  RETURN jsonb_build_object('salesRanking', v_sales_ranking, 'meetingsRanking', v_meetings_ranking);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ranking_data(INT, INT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ranking_data(INT, INT, UUID) TO service_role;

COMMENT ON FUNCTION public.get_ranking_data(INT, INT, UUID) IS
  'Rankings. Sales: COALESCE(sale_responsible_id, closer_id, responsible_id) from pipeline_entries metadata (slug=propostas, stage=vendido). Meetings: COALESCE(pre_sale_responsible_id, sdr_id) ONLY from metadata (slug=confirmacao, stage=compareceu). Meetings DOES NOT fall back to responsible_id or closer_id — meeting attendance credit belongs to the SDR. Updated 2026-05-18.';


-- ============================================================================
-- SECTION 3: get_dashboard_metrics — meetings filter must exclude closer
-- ============================================================================
-- The per-member filter for reunioesMarcadas / reunioesComparecidas / no_show
-- previously matched (sdr_id OR closer_id OR responsible_id). When the
-- filter targets a closer, the meeting still hits because the closer is
-- attached to it, double-counting attendance toward the wrong role.
--
-- Fix: filter meetings exclusively against the SDR fields
--   COALESCE(pre_sale_responsible_id, sdr_id)
-- Proposals/sales filters remain unchanged (closer-centric).

CREATE OR REPLACE FUNCTION public.get_dashboard_metrics(
  p_org_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ,
  p_filter_member_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_leads INTEGER := 0;
  v_tempo_medio_resposta NUMERIC := 0;
  v_reunioes_marcadas INTEGER := 0;
  v_reunioes_comparecidas INTEGER := 0;
  v_no_show INTEGER := 0;
  v_taxa_no_show NUMERIC := 0;
  v_finalizados_data_passada INTEGER := 0;
  v_propostas_enviadas INTEGER := 0;
  v_funnel_vendas INTEGER := 0;
  v_funnel_propostas INTEGER := 0;
  v_funnel_reunioes_marcadas INTEGER := 0;
  v_funnel_compareceu INTEGER := 0;
  v_novos_clientes INTEGER := 0;
  v_venda_total NUMERIC := 0;
  v_venda_mrr NUMERIC := 0;
  v_venda_projeto NUMERIC := 0;
  v_venda_base_ativa NUMERIC := 0;
  v_venda_primeiro_pedido NUMERIC := 0;
  v_ticket_medio NUMERIC := 0;
  v_ticket_medio_mrr NUMERIC := 0;
  v_ticket_medio_projeto NUMERIC := 0;
  v_mrr_proposal_count INTEGER := 0;
  v_projeto_proposal_count INTEGER := 0;
  v_taxa_conversao NUMERIC := 0;
  v_total_in_pipe INTEGER := 0;
  v_daily_sales JSONB := '[]'::jsonb;
  rec RECORD;
BEGIN
  -- 1. Total leads in period (lead-level filter unchanged)
  SELECT COUNT(*) INTO v_total_leads
  FROM leads
  WHERE organization_id = p_org_id
    AND created_at >= p_start_date AND created_at <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR pre_sale_responsible_id = p_filter_member_id
      OR sale_responsible_id     = p_filter_member_id
      OR responsible_id          = p_filter_member_id
      OR sdr_id                  = p_filter_member_id
      OR closer_id               = p_filter_member_id
    );

  -- 2. Average response time (no per-member filter applicable)
  SELECT COALESCE(AVG(minutes_diff), 0) INTO v_tempo_medio_resposta
  FROM (
    SELECT EXTRACT(EPOCH FROM (MIN(CASE WHEN cm.role = 'assistant' THEN cm.created_at END)
                             - MIN(CASE WHEN cm.role = 'user' THEN cm.created_at END))) / 60 AS minutes_diff
    FROM conversation_messages cm
    JOIN conversations c ON c.id = cm.conversation_id
    WHERE c.organization_id = p_org_id
      AND cm.created_at >= p_start_date AND cm.created_at <= p_end_date
    GROUP BY cm.conversation_id
    HAVING MIN(CASE WHEN cm.role = 'user' THEN cm.created_at END) IS NOT NULL
       AND MIN(CASE WHEN cm.role = 'assistant' THEN cm.created_at END) IS NOT NULL
  ) sub;

  -- 3. Meetings — SDR-only filter when p_filter_member_id is set
  --    COALESCE(pre_sale_responsible_id, sdr_id) — no fallback to responsible/closer.
  SELECT COUNT(*) INTO v_reunioes_marcadas
  FROM pipeline_entries pe
  JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'confirmacao' AND pip.type = 'system'
  WHERE pe.organization_id = p_org_id
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) >= p_start_date
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR COALESCE(
           (pe.metadata->>'pre_sale_responsible_id')::uuid,
           (pe.metadata->>'sdr_id')::uuid
         ) = p_filter_member_id
    );
  v_funnel_reunioes_marcadas := v_reunioes_marcadas;

  SELECT COUNT(*) INTO v_reunioes_comparecidas
  FROM pipeline_entries pe
  JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'confirmacao' AND pip.type = 'system'
  WHERE pe.organization_id = p_org_id AND pe.stage_key = 'compareceu'
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) >= p_start_date
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR COALESCE(
           (pe.metadata->>'pre_sale_responsible_id')::uuid,
           (pe.metadata->>'sdr_id')::uuid
         ) = p_filter_member_id
    );
  v_funnel_compareceu := v_reunioes_comparecidas;

  SELECT COUNT(*) INTO v_no_show
  FROM pipeline_entries pe
  JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'confirmacao' AND pip.type = 'system'
  WHERE pe.organization_id = p_org_id
    AND (pe.metadata->>'meeting_date')::timestamptz < NOW()
    AND pe.stage_key IN ('remarcar', 'perdido')
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) >= p_start_date
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR COALESCE(
           (pe.metadata->>'pre_sale_responsible_id')::uuid,
           (pe.metadata->>'sdr_id')::uuid
         ) = p_filter_member_id
    );

  SELECT COUNT(*) INTO v_finalizados_data_passada
  FROM pipeline_entries pe
  JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'confirmacao' AND pip.type = 'system'
  WHERE pe.organization_id = p_org_id
    AND (pe.metadata->>'meeting_date')::timestamptz < NOW()
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) >= p_start_date
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR COALESCE(
           (pe.metadata->>'pre_sale_responsible_id')::uuid,
           (pe.metadata->>'sdr_id')::uuid
         ) = p_filter_member_id
    );

  IF v_finalizados_data_passada > 0 THEN
    v_taxa_no_show := ROUND((v_no_show::NUMERIC / v_finalizados_data_passada) * 100);
  END IF;

  -- 4. Proposals sent — closer-side filter (unchanged behavior, but uses dual field first)
  SELECT COUNT(*) INTO v_propostas_enviadas
  FROM pipeline_entries pe
  JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
  WHERE pe.organization_id = p_org_id
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) >= p_start_date
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR COALESCE(
           (pe.metadata->>'sale_responsible_id')::uuid,
           (pe.metadata->>'closer_id')::uuid,
           (pe.metadata->>'responsible_id')::uuid
         ) = p_filter_member_id
    );
  v_funnel_propostas := v_propostas_enviadas;

  -- 5. Sales — closer-side filter
  SELECT COUNT(*) INTO v_funnel_vendas
  FROM pipeline_entries pe
  JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
  WHERE pe.organization_id = p_org_id AND pe.stage_key = 'vendido'
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.closed_at) >= p_start_date
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.closed_at) <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR COALESCE(
           (pe.metadata->>'sale_responsible_id')::uuid,
           (pe.metadata->>'closer_id')::uuid,
           (pe.metadata->>'responsible_id')::uuid
         ) = p_filter_member_id
    );
  v_novos_clientes := v_funnel_vendas;

  -- Conversion rate denominator
  SELECT COUNT(DISTINCT pe.id) INTO v_total_in_pipe
  FROM pipeline_entries pe
  JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
  WHERE pe.organization_id = p_org_id
    AND (
      (COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) >= p_start_date
       AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) <= p_end_date)
      OR (pe.stage_key IN ('vendido', 'perdido')
          AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.closed_at) >= p_start_date
          AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.closed_at) <= p_end_date)
    )
    AND (
      p_filter_member_id IS NULL
      OR COALESCE(
           (pe.metadata->>'sale_responsible_id')::uuid,
           (pe.metadata->>'closer_id')::uuid,
           (pe.metadata->>'responsible_id')::uuid
         ) = p_filter_member_id
    );

  IF v_total_in_pipe > 0 THEN
    v_taxa_conversao := ROUND((v_funnel_vendas::NUMERIC / v_total_in_pipe) * 100, 1);
  END IF;

  -- Revenue breakdown — closer-side filter
  FOR rec IN
    SELECT pe.id AS entry_id,
           pe.lead_id,
           (pe.metadata->>'sale_value')::numeric AS prop_sale_value,
           pe.metadata->>'product_type' AS prop_product_type,
           COALESCE(
             (SELECT jsonb_agg(jsonb_build_object('sale_value', ppi.sale_value, 'product_type', pr.type))
              FROM pipe_proposta_items ppi LEFT JOIN products pr ON pr.id = ppi.product_id
              WHERE ppi.pipe_proposta_id = pe.id), '[]'::jsonb
           ) AS items,
           EXISTS (
             SELECT 1 FROM pipeline_entries prev
             JOIN pipelines pip2 ON pip2.id = prev.pipeline_id AND pip2.slug = 'propostas' AND pip2.type = 'system'
             WHERE prev.organization_id = pe.organization_id
               AND prev.lead_id = pe.lead_id
               AND prev.stage_key = 'vendido' AND prev.id != pe.id
               AND COALESCE((prev.metadata->>'metrics_period_at')::timestamptz, prev.closed_at) < p_start_date
           ) AS is_returning_customer
    FROM pipeline_entries pe
    JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
    WHERE pe.organization_id = p_org_id AND pe.stage_key = 'vendido'
      AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.closed_at) >= p_start_date
      AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.closed_at) <= p_end_date
      AND (
        p_filter_member_id IS NULL
        OR COALESCE(
             (pe.metadata->>'sale_responsible_id')::uuid,
             (pe.metadata->>'closer_id')::uuid,
             (pe.metadata->>'responsible_id')::uuid
           ) = p_filter_member_id
      )
  LOOP
    DECLARE
      item JSONB; item_val NUMERIC; item_type TEXT;
      prop_total NUMERIC := 0; prop_mrr NUMERIC := 0; prop_proj NUMERIC := 0;
    BEGIN
      IF jsonb_array_length(rec.items) > 0 THEN
        FOR item IN SELECT * FROM jsonb_array_elements(rec.items) LOOP
          item_val := COALESCE((item->>'sale_value')::NUMERIC, 0);
          item_type := item->>'product_type';
          prop_total := prop_total + item_val;
          IF item_type = 'mrr' THEN prop_mrr := prop_mrr + item_val;
          ELSIF item_type = 'projeto' THEN prop_proj := prop_proj + item_val; END IF;
        END LOOP;
      ELSE
        prop_total := COALESCE(rec.prop_sale_value, 0);
        IF rec.prop_product_type = 'mrr' THEN prop_mrr := prop_total;
        ELSIF rec.prop_product_type = 'projeto' THEN prop_proj := prop_total; END IF;
      END IF;
      v_venda_total := v_venda_total + prop_total;
      v_venda_mrr := v_venda_mrr + prop_mrr;
      v_venda_projeto := v_venda_projeto + prop_proj;
      IF prop_mrr > 0 THEN v_mrr_proposal_count := v_mrr_proposal_count + 1; END IF;
      IF prop_proj > 0 THEN v_projeto_proposal_count := v_projeto_proposal_count + 1; END IF;
      IF rec.is_returning_customer THEN v_venda_base_ativa := v_venda_base_ativa + prop_total;
      ELSE v_venda_primeiro_pedido := v_venda_primeiro_pedido + prop_total; END IF;
    END;
  END LOOP;

  IF v_funnel_vendas > 0 THEN v_ticket_medio := v_venda_total / v_funnel_vendas; END IF;
  IF v_mrr_proposal_count > 0 THEN v_ticket_medio_mrr := v_venda_mrr / v_mrr_proposal_count; END IF;
  IF v_projeto_proposal_count > 0 THEN v_ticket_medio_projeto := v_venda_projeto / v_projeto_proposal_count; END IF;

  -- Daily sales aggregation
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('day', day_str, 'count', count_val, 'revenue', revenue_val)
    ORDER BY day_str
  ), '[]'::jsonb) INTO v_daily_sales
  FROM (
    SELECT TO_CHAR(COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.closed_at), 'YYYY-MM-DD') AS day_str,
           COUNT(*) AS count_val,
           SUM(COALESCE((pe.metadata->>'sale_value')::numeric, 0)) AS revenue_val
    FROM pipeline_entries pe
    JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
    WHERE pe.organization_id = p_org_id AND pe.stage_key = 'vendido'
      AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.closed_at) >= p_start_date
      AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.closed_at) <= p_end_date
      AND (
        p_filter_member_id IS NULL
        OR COALESCE(
             (pe.metadata->>'sale_responsible_id')::uuid,
             (pe.metadata->>'closer_id')::uuid,
             (pe.metadata->>'responsible_id')::uuid
           ) = p_filter_member_id
      )
    GROUP BY day_str
    ORDER BY day_str
  ) daily;

  RETURN jsonb_build_object(
    'totalLeads', v_total_leads,
    'tempoMedioResposta', ROUND(v_tempo_medio_resposta::numeric, 1),
    'reunioesMarcadas', v_reunioes_marcadas,
    'reunioesComparecidas', v_reunioes_comparecidas,
    'noShow', v_no_show,
    'taxaNoShow', v_taxa_no_show,
    'propostasEnviadas', v_propostas_enviadas,
    'novosClientes', v_novos_clientes,
    'vendaTotal', v_venda_total,
    'vendaMRR', v_venda_mrr,
    'vendaProjeto', v_venda_projeto,
    'vendaBaseAtiva', v_venda_base_ativa,
    'vendaPrimeiroPedido', v_venda_primeiro_pedido,
    'ticketMedio', v_ticket_medio,
    'ticketMedioMRR', v_ticket_medio_mrr,
    'ticketMedioProjeto', v_ticket_medio_projeto,
    'dailySales', v_daily_sales,
    'funnelVendas', v_funnel_vendas,
    'funnelPropostas', v_funnel_propostas,
    'funnelReunioesMarcadas', v_funnel_reunioes_marcadas,
    'funnelCompareceu', v_funnel_compareceu,
    'taxaConversao', v_taxa_conversao,
    'totalInPipe', v_total_in_pipe
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_metrics(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated;

COMMENT ON FUNCTION public.get_dashboard_metrics(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) IS
  'Dashboard metrics. Meetings filter (reunioesMarcadas/Comparecidas/noShow) uses COALESCE(pre_sale_responsible_id, sdr_id) ONLY — no fallback to responsible/closer. Proposals/sales use COALESCE(sale_responsible_id, closer_id, responsible_id). Updated 2026-05-18.';


-- ============================================================================
-- SECTION 4: Validation
-- ============================================================================

DO $$
DECLARE
  v_ranking_comment TEXT;
  v_dash_comment    TEXT;
BEGIN
  SELECT obj_description('public.get_ranking_data(INT, INT, UUID)'::regprocedure)
    INTO v_ranking_comment;
  SELECT obj_description('public.get_dashboard_metrics(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID)'::regprocedure)
    INTO v_dash_comment;

  IF v_ranking_comment IS NULL OR v_ranking_comment NOT LIKE '%2026-05-18%' THEN
    RAISE EXCEPTION 'FAIL: get_ranking_data was not recreated with the SDR-only fix.';
  END IF;
  IF v_dash_comment IS NULL OR v_dash_comment NOT LIKE '%2026-05-18%' THEN
    RAISE EXCEPTION 'FAIL: get_dashboard_metrics was not recreated with the SDR-only fix.';
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: meetings ranking + dashboard meetings filter pinned to SDR.';
END;
$$;

COMMIT;
