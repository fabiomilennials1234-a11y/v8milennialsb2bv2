-- ============================================================================
-- Snapshot Responsible from Lead — DB-driven snapshot trigger + RPC cleanup.
--
-- PRD #211 / Slice S1 (#212).
--
-- Background
-- ----------
-- Migration 20260982000000_drop_legacy_pipe_tables.sql removed the prospective
-- sync trigger `sync_dual_responsible_to_lead_from_pipe`. After Phase 4 the
-- live pipes are gone and pipe_confirmacao / pipe_propostas are read-only
-- compat views over pipeline_entries.metadata. The Dashboard and Ranking
-- consequently lost the link between the avatars shown on the lead and the
-- members credited in metrics.
--
-- Commit e3ac4599 fixed get_ranking_data / get_dashboard_metrics for the
-- meetings ranking and backfilled metadata, but did NOT reinstate the
-- prospective synchronization mechanism. New entries (every meeting scheduled
-- or sale recorded from now on) snapshot whatever the lead-level responsible
-- happened to be at the moment the row was inserted, with no automatic capture
-- driven from the lead.
--
-- Architectural decision (ratified by CTO — not re-discussed)
-- -----------------------------------------------------------
-- Snapshot is frozen by the DATABASE on two events: entry creation, and final
-- transition. Lead is the source of truth for who currently owns the
-- relationship. Entry metadata is the historical snapshot of who owned it at
-- the moment the credit-worthy event happened.
--
--   Rule 1. INSERT on pipeline_entries with pipelines.slug='confirmacao'
--           → copy leads.pre_sale_responsible_id
--             into NEW.metadata.pre_sale_responsible_id.
--
--   Rule 2. INSERT on pipeline_entries with pipelines.slug='propostas'
--           → copy leads.sale_responsible_id
--             into NEW.metadata.sale_responsible_id.
--
--   Rule 3. UPDATE OF stage_key on pipeline_entries with pipelines.slug
--           ='confirmacao' transitioning into stage_key='compareceu'
--           → re-read leads.pre_sale_responsible_id and overwrite
--             NEW.metadata.pre_sale_responsible_id with the current value.
--
--   Rule 4. UPDATE OF stage_key on pipeline_entries with pipelines.slug
--           ='propostas' transitioning into stage_key='vendido'
--           → re-read leads.sale_responsible_id and overwrite
--             NEW.metadata.sale_responsible_id with the current value.
--
-- The trigger NEVER reads sdr_id / closer_id / responsible_id from the lead
-- and NEVER writes legacy keys into metadata. Legacy keys remain readable
-- on rows that already had them; they will be progressively removed by the
-- backfill below and by future slice S3 (#214) cleanup of frontend writers.
--
-- RPC cleanup
-- -----------
-- get_ranking_data and get_dashboard_metrics are rewritten to drop the
-- COALESCE chain to legacy ids. They now read pre_sale_responsible_id /
-- sale_responsible_id directly. Cross-tenant safety preserved by the original
-- organization_id filter; legacy fallback was a maintenance hazard. Lead-level
-- `total_leads` filter is reduced to dual fields only as well.
--
-- Dependencies
-- ------------
-- Builds on 20261024000000_fix_meetings_ranking_sdr_only.sql (committed by
-- e3ac4599). That migration backfilled metadata so the direct-read shape is
-- safe; the final backfill in section 4 is idempotent.
--
-- Apply scope
-- -----------
-- DEV only. Production deploy must be requested explicitly.
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1: Trigger function — snapshot_responsible_from_lead
-- ============================================================================
-- BEFORE INSERT OR UPDATE OF stage_key on pipeline_entries. Reads the lead via
-- the FK pipeline_entries.lead_id → leads.id and writes the snapshot into
-- NEW.metadata. SECURITY DEFINER so the trigger can read the lead row even
-- when the invoking user holds restricted RLS on leads — the trigger acts
-- inside the same transaction that already authorized the entry write, so the
-- caller has, by construction, already been allowed to operate on this lead.
--
-- IMPORTANT: pipelines is queried by primary key (id) inside the trigger.
-- The JOIN does NOT depend on RLS; pipelines RLS allows org-scoped SELECT for
-- authenticated users and SECURITY DEFINER bypasses any restrictive policy on
-- pipelines anyway. We still cross-check pipelines.organization_id matches
-- the entry's organization_id to harden against accidental cross-org wiring.

CREATE OR REPLACE FUNCTION public.snapshot_responsible_from_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pipeline_slug TEXT;
  v_pipeline_type TEXT;
  v_pipeline_org  UUID;
  v_lead_pre_sale UUID;
  v_lead_sale     UUID;
  v_event_kind    TEXT; -- 'insert' | 'transition_compareceu' | 'transition_vendido'
  v_should_act    BOOLEAN := FALSE;
BEGIN
  -- Resolve pipeline slug + tenancy in a single read.
  SELECT p.slug, p.type, p.organization_id
    INTO v_pipeline_slug, v_pipeline_type, v_pipeline_org
  FROM public.pipelines p
  WHERE p.id = NEW.pipeline_id;

  -- Defensive: cross-org wiring should never happen. Bail out without writing.
  IF v_pipeline_org IS NULL OR v_pipeline_org <> NEW.organization_id THEN
    RETURN NEW;
  END IF;

  -- Only system pipes are tracked by this snapshot. Custom pipelines have
  -- their own attribution semantics.
  IF v_pipeline_type IS DISTINCT FROM 'system' THEN
    RETURN NEW;
  END IF;

  -- Decide whether we act, and what to capture.
  IF TG_OP = 'INSERT' THEN
    IF v_pipeline_slug = 'confirmacao' OR v_pipeline_slug = 'propostas' THEN
      v_event_kind := 'insert';
      v_should_act := TRUE;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Only act on actual transition into the credit-worthy stage.
    IF v_pipeline_slug = 'confirmacao'
       AND NEW.stage_key = 'compareceu'
       AND COALESCE(OLD.stage_key, '') IS DISTINCT FROM 'compareceu' THEN
      v_event_kind := 'transition_compareceu';
      v_should_act := TRUE;
    ELSIF v_pipeline_slug = 'propostas'
       AND NEW.stage_key = 'vendido'
       AND COALESCE(OLD.stage_key, '') IS DISTINCT FROM 'vendido' THEN
      v_event_kind := 'transition_vendido';
      v_should_act := TRUE;
    END IF;
  END IF;

  IF NOT v_should_act THEN
    RETURN NEW;
  END IF;

  -- Defensive: lead_id is required to snapshot. If absent, leave metadata
  -- untouched (write paths that legitimately omit lead_id are out of scope).
  IF NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Read the lead's current dual responsibles. Scoped by organization_id for
  -- belt-and-suspenders cross-tenant safety; lead FK already enforces it.
  SELECT l.pre_sale_responsible_id, l.sale_responsible_id
    INTO v_lead_pre_sale, v_lead_sale
  FROM public.leads l
  WHERE l.id = NEW.lead_id
    AND l.organization_id = NEW.organization_id;

  -- Ensure metadata is a jsonb object we can extend.
  IF NEW.metadata IS NULL THEN
    NEW.metadata := '{}'::jsonb;
  END IF;

  -- Apply the snapshot. We write only the relevant field per pipe to avoid
  -- bleeding pre_sale into propostas (and vice versa).
  IF v_pipeline_slug = 'confirmacao' THEN
    NEW.metadata := jsonb_set(
      NEW.metadata,
      '{pre_sale_responsible_id}',
      CASE
        WHEN v_lead_pre_sale IS NULL THEN 'null'::jsonb
        ELSE to_jsonb(v_lead_pre_sale::text)
      END,
      TRUE
    );
  ELSIF v_pipeline_slug = 'propostas' THEN
    NEW.metadata := jsonb_set(
      NEW.metadata,
      '{sale_responsible_id}',
      CASE
        WHEN v_lead_sale IS NULL THEN 'null'::jsonb
        ELSE to_jsonb(v_lead_sale::text)
      END,
      TRUE
    );
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.snapshot_responsible_from_lead() IS
  'BEFORE INSERT/UPDATE OF stage_key on pipeline_entries. Captures the lead-level '
  'pre_sale_responsible_id (slug=confirmacao) or sale_responsible_id '
  '(slug=propostas) into NEW.metadata on entry creation and on transition to '
  'the credit-worthy stage (compareceu / vendido). NEVER reads legacy '
  'sdr_id/closer_id/responsible_id and NEVER writes them. SECURITY DEFINER, '
  'org-scoped via FK + explicit organization_id check. Introduced 2026-05-18 '
  'as part of PRD #211 (issue #212).';

-- Trigger registration. Drop any prior conflicting handler.
DROP TRIGGER IF EXISTS trg_snapshot_responsible_from_lead ON public.pipeline_entries;

CREATE TRIGGER trg_snapshot_responsible_from_lead
  BEFORE INSERT OR UPDATE OF stage_key
  ON public.pipeline_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.snapshot_responsible_from_lead();


-- ============================================================================
-- SECTION 2: get_ranking_data — drop legacy COALESCE chains
-- ============================================================================
-- Shape preserved (salesRanking, meetingsRanking). Grouping now reads the
-- dual fields directly; the trigger + the section-4 backfill guarantee that
-- new entries always carry the relevant key (or NULL → bucket "sem SDR" /
-- "sem closer" by design).

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
    FROM public.team_members tm
    WHERE tm.user_id = auth.uid() AND tm.is_active = true
    LIMIT 1;
  END IF;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('salesRanking', '[]'::jsonb, 'meetingsRanking', '[]'::jsonb);
  END IF;

  v_start_ts := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'UTC');
  v_end_ts := ((make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date
                + time '23:59:59.999') AT TIME ZONE 'UTC';

  -- ── Closer / Sales ranking ──────────────────────────────────────────────
  -- Group by sale_responsible_id ONLY. No legacy fallback.
  WITH sales_agg AS (
    SELECT (pe.metadata->>'sale_responsible_id')::uuid AS member_id,
           SUM(COALESCE((pe.metadata->>'sale_value')::numeric, 0))::numeric AS total_value,
           COUNT(*)::int AS conversions
    FROM public.pipeline_entries pe
    JOIN public.pipelines pip ON pip.id = pe.pipeline_id
      AND pip.slug = 'propostas' AND pip.type = 'system'
    WHERE pe.organization_id = v_org_id
      AND pe.stage_key = 'vendido'
      AND NULLIF(pe.metadata->>'sale_responsible_id', '') IS NOT NULL
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
  -- Group by pre_sale_responsible_id ONLY. No legacy fallback. Entries with
  -- NULL pre_sale_responsible_id fall in the "sem SDR" bucket by design.
  WITH meetings_agg AS (
    SELECT (pe.metadata->>'pre_sale_responsible_id')::uuid AS member_id,
           COUNT(DISTINCT pe.id)::int AS total_meetings
    FROM public.pipeline_entries pe
    JOIN public.pipelines pip ON pip.id = pe.pipeline_id
      AND pip.slug = 'confirmacao' AND pip.type = 'system'
    WHERE pe.organization_id = v_org_id
      AND pe.stage_key = 'compareceu'
      AND NULLIF(pe.metadata->>'pre_sale_responsible_id', '') IS NOT NULL
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
  'Rankings. Sales: pe.metadata->>sale_responsible_id (slug=propostas, '
  'stage=vendido). Meetings: pe.metadata->>pre_sale_responsible_id '
  '(slug=confirmacao, stage=compareceu). No legacy fallback. Snapshot is '
  'captured by trigger snapshot_responsible_from_lead. Updated 2026-05-18 '
  '(PRD #211 / #212).';


-- ============================================================================
-- SECTION 3: get_dashboard_metrics — drop legacy COALESCE chains
-- ============================================================================
-- Shape preserved. Meetings filter uses pre_sale_responsible_id ONLY.
-- Proposals/sales filter uses sale_responsible_id ONLY. Lead-level
-- total_leads filter reduced to dual fields only.

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
  -- 1. Total leads in period — lead-level filter on dual fields only.
  SELECT COUNT(*) INTO v_total_leads
  FROM leads
  WHERE organization_id = p_org_id
    AND created_at >= p_start_date AND created_at <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR pre_sale_responsible_id = p_filter_member_id
      OR sale_responsible_id     = p_filter_member_id
    );

  -- 2. Average response time (no per-member filter applicable).
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

  -- 3. Meetings — per-member filter on pre_sale_responsible_id ONLY.
  SELECT COUNT(*) INTO v_reunioes_marcadas
  FROM pipeline_entries pe
  JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'confirmacao' AND pip.type = 'system'
  WHERE pe.organization_id = p_org_id
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) >= p_start_date
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR (pe.metadata->>'pre_sale_responsible_id')::uuid = p_filter_member_id
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
      OR (pe.metadata->>'pre_sale_responsible_id')::uuid = p_filter_member_id
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
      OR (pe.metadata->>'pre_sale_responsible_id')::uuid = p_filter_member_id
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
      OR (pe.metadata->>'pre_sale_responsible_id')::uuid = p_filter_member_id
    );

  IF v_finalizados_data_passada > 0 THEN
    v_taxa_no_show := ROUND((v_no_show::NUMERIC / v_finalizados_data_passada) * 100);
  END IF;

  -- 4. Proposals sent — closer-side filter on sale_responsible_id ONLY.
  SELECT COUNT(*) INTO v_propostas_enviadas
  FROM pipeline_entries pe
  JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
  WHERE pe.organization_id = p_org_id
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) >= p_start_date
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR (pe.metadata->>'sale_responsible_id')::uuid = p_filter_member_id
    );
  v_funnel_propostas := v_propostas_enviadas;

  -- 5. Sales — closer-side filter on sale_responsible_id ONLY.
  SELECT COUNT(*) INTO v_funnel_vendas
  FROM pipeline_entries pe
  JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
  WHERE pe.organization_id = p_org_id AND pe.stage_key = 'vendido'
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.closed_at) >= p_start_date
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.closed_at) <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR (pe.metadata->>'sale_responsible_id')::uuid = p_filter_member_id
    );
  v_novos_clientes := v_funnel_vendas;

  -- Conversion rate denominator.
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
      OR (pe.metadata->>'sale_responsible_id')::uuid = p_filter_member_id
    );

  IF v_total_in_pipe > 0 THEN
    v_taxa_conversao := ROUND((v_funnel_vendas::NUMERIC / v_total_in_pipe) * 100, 1);
  END IF;

  -- Revenue breakdown — closer-side filter on sale_responsible_id ONLY.
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
        OR (pe.metadata->>'sale_responsible_id')::uuid = p_filter_member_id
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

  -- Daily sales aggregation — closer-side filter on sale_responsible_id ONLY.
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
        OR (pe.metadata->>'sale_responsible_id')::uuid = p_filter_member_id
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
  'Dashboard metrics. Meetings filter uses pe.metadata->>pre_sale_responsible_id '
  'ONLY. Proposals/sales filter uses pe.metadata->>sale_responsible_id ONLY. '
  'total_leads lead-level filter restricted to leads dual fields. No legacy '
  'fallback anywhere. Snapshot captured by trigger snapshot_responsible_from_lead. '
  'Updated 2026-05-18 (PRD #211 / #212).';


-- ============================================================================
-- SECTION 4: Idempotent cleanup of legacy keys in metadata
-- ============================================================================
-- Strip sdr_id / closer_id / responsible_id from pipeline_entries.metadata in
-- rows where either dual key is already populated. Rows where neither dual
-- key was ever populated keep their legacy keys for cosmetic readability (the
-- UI can still display the avatar from legacy ids until S3/#214 cleans up
-- frontend writers).

UPDATE public.pipeline_entries
SET metadata = metadata - 'sdr_id' - 'closer_id' - 'responsible_id'
WHERE metadata IS NOT NULL
  AND (
    NULLIF(metadata->>'pre_sale_responsible_id', '') IS NOT NULL
    OR NULLIF(metadata->>'sale_responsible_id', '') IS NOT NULL
  )
  AND (
    metadata ? 'sdr_id'
    OR metadata ? 'closer_id'
    OR metadata ? 'responsible_id'
  );


-- ============================================================================
-- SECTION 5: Validation
-- ============================================================================

DO $$
DECLARE
  v_trg_count       INT;
  v_fn_snapshot     INT;
  v_ranking_comment TEXT;
  v_dash_comment    TEXT;
BEGIN
  SELECT COUNT(*) INTO v_trg_count
  FROM pg_trigger
  WHERE tgname = 'trg_snapshot_responsible_from_lead'
    AND tgrelid = 'public.pipeline_entries'::regclass
    AND NOT tgisinternal;

  SELECT COUNT(*) INTO v_fn_snapshot
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'snapshot_responsible_from_lead';

  SELECT obj_description('public.get_ranking_data(INT, INT, UUID)'::regprocedure)
    INTO v_ranking_comment;
  SELECT obj_description('public.get_dashboard_metrics(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID)'::regprocedure)
    INTO v_dash_comment;

  IF v_trg_count = 0 THEN
    RAISE EXCEPTION 'FAIL: trigger trg_snapshot_responsible_from_lead was not installed.';
  END IF;
  IF v_fn_snapshot = 0 THEN
    RAISE EXCEPTION 'FAIL: function snapshot_responsible_from_lead was not created.';
  END IF;
  IF v_ranking_comment IS NULL OR v_ranking_comment NOT LIKE '%PRD #211%' THEN
    RAISE EXCEPTION 'FAIL: get_ranking_data comment not updated for PRD #211.';
  END IF;
  IF v_dash_comment IS NULL OR v_dash_comment NOT LIKE '%PRD #211%' THEN
    RAISE EXCEPTION 'FAIL: get_dashboard_metrics comment not updated for PRD #211.';
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: snapshot trigger + RPC cleanup installed.';
END;
$$;

COMMIT;
