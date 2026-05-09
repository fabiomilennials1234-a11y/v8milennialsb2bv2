-- ============================================================================
-- Phase 4: Drop Legacy Pipe Tables
-- ============================================================================
-- Completes the pipeline unification migration.
--   1. Create trigger to keep leads.pipe_whatsapp cache in sync
--   2. Drop bidirectional sync triggers and functions
--   3. Update all SQL RPCs from legacy tables to pipeline_entries
--   4. Re-point foreign keys to pipeline_entries
--   5. Drop the 3 legacy tables (pipe_whatsapp, pipe_confirmacao, pipe_propostas)
--   6. Attach new whatsapp cache trigger
-- ============================================================================

BEGIN;

-- ============================================================================
-- Section 1: Trigger function for leads.pipe_whatsapp cache
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_pipeline_entry_to_lead_pipe_whatsapp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug TEXT;
BEGIN
  -- Prevent circular trigger execution
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Resolve slug for the deleted entry
    SELECT pip.slug INTO v_slug
    FROM public.pipelines pip
    WHERE pip.id = OLD.pipeline_id AND pip.type = 'system';

    IF v_slug = 'whatsapp' THEN
      UPDATE public.leads SET pipe_whatsapp = NULL WHERE id = OLD.lead_id;
    END IF;

    RETURN OLD;
  END IF;

  -- INSERT or UPDATE
  SELECT pip.slug INTO v_slug
  FROM public.pipelines pip
  WHERE pip.id = NEW.pipeline_id AND pip.type = 'system';

  IF v_slug = 'whatsapp' THEN
    UPDATE public.leads SET pipe_whatsapp = NEW.stage_key WHERE id = NEW.lead_id;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- Section 2: Drop bidirectional sync triggers and functions
-- ============================================================================

-- Drop triggers on pipeline_entries (reverse sync)
DROP TRIGGER IF EXISTS trg_sync_entries_to_legacy ON public.pipeline_entries;

-- Drop triggers on legacy tables (forward sync)
DROP TRIGGER IF EXISTS trg_sync_pipe_whatsapp_to_entries ON public.pipe_whatsapp;
DROP TRIGGER IF EXISTS trg_sync_pipe_confirmacao_to_entries ON public.pipe_confirmacao;
DROP TRIGGER IF EXISTS trg_sync_pipe_propostas_to_entries ON public.pipe_propostas;

-- Drop sync functions
DROP FUNCTION IF EXISTS public.sync_entries_to_legacy_pipes();
DROP FUNCTION IF EXISTS public.sync_legacy_pipe_to_entries();
DROP FUNCTION IF EXISTS public.migrate_pipe_entries(INT);

-- Drop validation triggers on legacy tables (prevent stage_key validation errors)
DROP TRIGGER IF EXISTS trg_validate_pipe_whatsapp_status ON public.pipe_whatsapp;
DROP TRIGGER IF EXISTS trg_validate_pipe_confirmacao_status ON public.pipe_confirmacao;
DROP TRIGGER IF EXISTS trg_validate_pipe_propostas_status ON public.pipe_propostas;

-- ============================================================================
-- Section 2b: Enrich pipeline_entries metadata from legacy tables
-- ============================================================================
-- Now safe to update pipeline_entries without triggering reverse sync.

UPDATE public.pipeline_entries pe SET
  metadata = jsonb_strip_nulls(jsonb_build_object(
    'scheduled_date', pw.scheduled_date,
    'sdr_id', pw.sdr_id,
    'responsible_id', pw.responsible_id,
    'pre_sale_responsible_id', pw.pre_sale_responsible_id,
    'sale_responsible_id', pw.sale_responsible_id
  ))
FROM pipe_whatsapp pw
JOIN pipelines p ON p.organization_id = pw.organization_id AND p.slug = 'whatsapp' AND p.type = 'system'
WHERE pe.id = pw.id AND pe.pipeline_id = p.id AND pe.metadata = '{}';

UPDATE public.pipeline_entries pe SET
  metadata = jsonb_strip_nulls(jsonb_build_object(
    'meeting_date', pc.meeting_date,
    'meet_link', pc.meet_link,
    'is_confirmed', pc.is_confirmed,
    'sdr_id', pc.sdr_id,
    'closer_id', pc.closer_id,
    'responsible_id', pc.responsible_id,
    'pre_sale_responsible_id', pc.pre_sale_responsible_id,
    'sale_responsible_id', pc.sale_responsible_id,
    'metrics_period_at', pc.metrics_period_at
  ))
FROM pipe_confirmacao pc
JOIN pipelines p ON p.organization_id = pc.organization_id AND p.slug = 'confirmacao' AND p.type = 'system'
WHERE pe.id = pc.id AND pe.pipeline_id = p.id AND pe.metadata = '{}';

UPDATE public.pipeline_entries pe SET
  metadata = jsonb_strip_nulls(jsonb_build_object(
    'sale_value', pp.sale_value,
    'product_type', pp.product_type,
    'product_id', pp.product_id,
    'calor', pp.calor,
    'loss_reason_id', pp.loss_reason_id,
    'commitment_date', pp.commitment_date,
    'contract_duration', pp.contract_duration,
    'closer_id', pp.closer_id,
    'responsible_id', pp.responsible_id,
    'pre_sale_responsible_id', pp.pre_sale_responsible_id,
    'sale_responsible_id', pp.sale_responsible_id,
    'metrics_period_at', pp.metrics_period_at
  ))
FROM pipe_propostas pp
JOIN pipelines p ON p.organization_id = pp.organization_id AND p.slug = 'propostas' AND p.type = 'system'
WHERE pe.id = pp.id AND pe.pipeline_id = p.id AND pe.metadata = '{}';

-- ============================================================================
-- Section 3: Update all SQL RPCs
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 3.1 distribute_pipe_round_robin
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.distribute_pipe_round_robin(
  p_pipe_type       TEXT,
  p_organization_id UUID,
  p_member_ids      UUID[]
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_last_assigned UUID;
  v_last_idx      INT;
  v_arr_len       INT;
BEGIN
  -- Serialize concurrent callers for the same pipe + org.
  PERFORM pg_advisory_xact_lock(
    hashtext('pipe_dist:' || p_pipe_type || ':' || p_organization_id::text)
  );

  v_arr_len := array_length(p_member_ids, 1);
  IF v_arr_len IS NULL OR v_arr_len = 0 THEN
    RETURN NULL;
  END IF;

  -- Find who was last assigned in this pipe (most recent record by created_at).
  -- Unified query: pipeline_entries JOIN pipelines by slug.
  SELECT COALESCE((pe.metadata->>'responsible_id')::uuid, pe.assigned_to) INTO v_last_assigned
  FROM public.pipeline_entries pe
  JOIN public.pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = p_pipe_type AND pip.type = 'system'
  WHERE pe.organization_id = p_organization_id
    AND COALESCE((pe.metadata->>'responsible_id')::uuid, pe.assigned_to) = ANY(p_member_ids)
  ORDER BY pe.created_at DESC
  LIMIT 1;

  -- No previous assignment -> pick first member.
  IF v_last_assigned IS NULL THEN
    RETURN p_member_ids[1];
  END IF;

  -- Find position of last assigned member in the array.
  v_last_idx := NULL;
  FOR i IN 1..v_arr_len LOOP
    IF p_member_ids[i] = v_last_assigned THEN
      v_last_idx := i;
      EXIT;
    END IF;
  END LOOP;

  -- If last assigned member is no longer in the pool, start from first.
  IF v_last_idx IS NULL THEN
    RETURN p_member_ids[1];
  END IF;

  -- Next in rotation (wrap around to 1 if at end).
  IF v_last_idx >= v_arr_len THEN
    RETURN p_member_ids[1];
  ELSE
    RETURN p_member_ids[v_last_idx + 1];
  END IF;
END;
$$;

COMMENT ON FUNCTION public.distribute_pipe_round_robin(TEXT, UUID, UUID[]) IS
  'Sequential round-robin for pipes via pipeline_entries. Finds last assigned member and picks the next in rotation order. Serialized by advisory lock.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3.2 get_next_pipe_closer
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_next_pipe_closer(
  p_pipe_type TEXT,
  p_organization_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_rule_id UUID;
  v_mode TEXT;
  v_assigned_to UUID;
  v_member_ids UUID[];
  v_count BIGINT;
  v_next_index INT;
BEGIN
  SELECT id, closer_mode, closer_assigned_to
    INTO v_rule_id, v_mode, v_assigned_to
  FROM public.pipe_distribution_rules
  WHERE organization_id = p_organization_id
    AND pipe_type = p_pipe_type
  LIMIT 1;

  IF v_rule_id IS NULL OR v_mode IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_mode = 'single' AND v_assigned_to IS NOT NULL THEN
    RETURN v_assigned_to;
  END IF;

  SELECT ARRAY_AGG(pdm.team_member_id ORDER BY pdm.created_at, pdm.team_member_id)
    INTO v_member_ids
  FROM public.pipe_distribution_members pdm
  WHERE pdm.rule_id = v_rule_id
    AND pdm.role = 'closer';

  IF v_member_ids IS NULL OR array_length(v_member_ids, 1) IS NULL OR array_length(v_member_ids, 1) = 0 THEN
    RETURN NULL;
  END IF;

  IF v_mode = 'random' THEN
    RETURN v_member_ids[1 + floor(random() * array_length(v_member_ids, 1))::int];
  END IF;

  IF v_mode = 'round_robin' THEN
    -- Count records with closer_id set in pipeline_entries for this pipe slug
    SELECT count(*) INTO v_count
    FROM public.pipeline_entries pe
    JOIN public.pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = p_pipe_type AND pip.type = 'system'
    WHERE pe.organization_id = p_organization_id
      AND (pe.metadata->>'closer_id')::uuid IS NOT NULL;

    v_next_index := (COALESCE(v_count, 0) % array_length(v_member_ids, 1)) + 1;
    RETURN v_member_ids[v_next_index];
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.get_next_pipe_closer(TEXT, UUID) IS
  'Retorna team_member_id do proximo Closer a atribuir no pipe via pipeline_entries (round_robin, random ou single).';

-- ────────────────────────────────────────────────────────────────────────────
-- 3.3 get_next_pipe_sdr (update round_robin branch)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_next_pipe_sdr(
  p_pipe_type TEXT,
  p_organization_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_rule_id     UUID;
  v_mode        TEXT;
  v_assigned_to UUID;
  v_member_ids  UUID[];
BEGIN
  SELECT id, sdr_mode, sdr_assigned_to
    INTO v_rule_id, v_mode, v_assigned_to
  FROM public.pipe_distribution_rules
  WHERE organization_id = p_organization_id
    AND pipe_type = p_pipe_type
  LIMIT 1;

  IF v_rule_id IS NULL OR v_mode IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_mode = 'single' AND v_assigned_to IS NOT NULL THEN
    RETURN v_assigned_to;
  END IF;

  -- Unified pool: all members for this rule, no role filter
  SELECT ARRAY_AGG(pdm.team_member_id ORDER BY pdm.created_at, pdm.team_member_id)
    INTO v_member_ids
  FROM public.pipe_distribution_members pdm
  WHERE pdm.rule_id = v_rule_id;

  IF v_member_ids IS NULL OR array_length(v_member_ids, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_mode = 'random' THEN
    RETURN v_member_ids[1 + floor(random() * array_length(v_member_ids, 1))::int];
  END IF;

  IF v_mode = 'round_robin' THEN
    RETURN public.distribute_pipe_round_robin(p_pipe_type, p_organization_id, v_member_ids);
  END IF;

  RETURN NULL;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3.4 get_seller_activity_scores
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_seller_activity_scores(
  p_org_id UUID, p_start_date TIMESTAMPTZ, p_end_date TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result JSONB;
BEGIN
  WITH seller_metrics AS (
    SELECT tm.id, tm.name, tm.role, (tm.metric_type)::TEXT AS metric_type,
      (SELECT COUNT(*)
       FROM leads l
       WHERE l.organization_id = p_org_id
         AND (l.sdr_id = tm.id OR l.closer_id = tm.id)
         AND COALESCE(l.metrics_period_at, l.created_at) >= p_start_date
         AND COALESCE(l.metrics_period_at, l.created_at) <= p_end_date
      ) AS leads_movimentados,
      (SELECT COUNT(*)
       FROM follow_ups fu
       WHERE fu.organization_id = p_org_id
         AND fu.assigned_to = tm.id
         AND fu.completed_at IS NOT NULL
         AND fu.completed_at >= p_start_date
         AND fu.completed_at <= p_end_date
      ) AS followups_completos,
      (SELECT COUNT(*)
       FROM pipeline_entries pe
       JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'confirmacao' AND pip.type = 'system'
       WHERE pe.organization_id = p_org_id
         AND ((pe.metadata->>'sdr_id')::uuid = tm.id OR (pe.metadata->>'closer_id')::uuid = tm.id)
         AND pe.stage_key = 'compareceu'
         AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) >= p_start_date
         AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) <= p_end_date
      ) AS reunioes_realizadas,
      (SELECT COUNT(*)
       FROM pipeline_entries pe
       JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
       WHERE pe.organization_id = p_org_id
         AND (pe.metadata->>'closer_id')::uuid = tm.id
         AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) >= p_start_date
         AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) <= p_end_date
      ) AS propostas_enviadas,
      (SELECT COUNT(*)
       FROM pipeline_entries pe
       JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
       WHERE pe.organization_id = p_org_id
         AND (pe.metadata->>'closer_id')::uuid = tm.id
         AND pe.stage_key = 'vendido'
         AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.closed_at) >= p_start_date
         AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.closed_at) <= p_end_date
      ) AS vendas_fechadas
    FROM team_members tm WHERE tm.organization_id = p_org_id AND tm.is_active = true
  ), scored AS (
    SELECT sm.*,
      (sm.leads_movimentados * 10 + sm.followups_completos * 15 + sm.reunioes_realizadas * 20 + sm.propostas_enviadas * 25 + sm.vendas_fechadas * 30) AS score_bruto
    FROM seller_metrics sm
  )
  SELECT jsonb_agg(jsonb_build_object(
    'id', s.id, 'name', s.name, 'role', s.role, 'metricType', s.metric_type,
    'leads', s.leads_movimentados, 'followups', s.followups_completos,
    'reunioes', s.reunioes_realizadas, 'propostas', s.propostas_enviadas,
    'vendas', s.vendas_fechadas, 'scoreBruto', s.score_bruto,
    'scoreNormalizado', CASE WHEN (SELECT MAX(score_bruto) FROM scored) > 0
      THEN ROUND((s.score_bruto::NUMERIC / (SELECT MAX(score_bruto) FROM scored)) * 100) ELSE 0 END
  ) ORDER BY s.score_bruto DESC) INTO result FROM scored s;
  RETURN COALESCE(result, '[]'::jsonb);
END; $$;

GRANT EXECUTE ON FUNCTION public.get_seller_activity_scores(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_seller_activity_scores(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 3.5 get_segment_benchmark
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_segment_benchmark(p_org_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_segment TEXT; v_org_count BIGINT; result JSONB;
  v_start TIMESTAMPTZ; v_end TIMESTAMPTZ;
BEGIN
  v_start := DATE_TRUNC('month', NOW());
  v_end := (DATE_TRUNC('month', NOW()) + INTERVAL '1 month' - INTERVAL '1 second');

  SELECT l.segment INTO v_segment
  FROM leads l
  WHERE l.organization_id = p_org_id AND l.segment IS NOT NULL AND l.segment != ''
  GROUP BY l.segment ORDER BY COUNT(*) DESC LIMIT 1;

  IF v_segment IS NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'no_segment_data');
  END IF;

  SELECT COUNT(DISTINCT o.id) INTO v_org_count
  FROM organizations o
  JOIN leads l ON l.organization_id = o.id
  WHERE l.segment = v_segment AND o.id != p_org_id;

  IF v_org_count < 2 THEN
    RETURN jsonb_build_object('available', false, 'reason', 'insufficient_peers', 'segment', v_segment);
  END IF;

  WITH peer_orgs AS (
    SELECT DISTINCT o.id AS org_id
    FROM organizations o
    JOIN leads l ON l.organization_id = o.id
    WHERE l.segment = v_segment AND o.id != p_org_id
  ), peer_metrics AS (
    SELECT po.org_id,
      (SELECT COUNT(*)
       FROM leads l
       WHERE l.organization_id = po.org_id
         AND COALESCE(l.metrics_period_at, l.created_at) >= v_start
         AND COALESCE(l.metrics_period_at, l.created_at) <= v_end
      ) AS leads,
      (SELECT COUNT(*)
       FROM pipeline_entries pe
       JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
       WHERE pe.organization_id = po.org_id
         AND pe.stage_key = 'vendido'
         AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.closed_at) >= v_start
         AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.closed_at) <= v_end
      ) AS vendas,
      (SELECT COALESCE(SUM((pe.metadata->>'sale_value')::numeric), 0)
       FROM pipeline_entries pe
       JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
       WHERE pe.organization_id = po.org_id
         AND pe.stage_key = 'vendido'
         AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.closed_at) >= v_start
         AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.closed_at) <= v_end
      ) AS revenue,
      (SELECT COUNT(*)
       FROM team_members tm
       WHERE tm.organization_id = po.org_id AND tm.is_active = true
      ) AS team_size
    FROM peer_orgs po
  )
  SELECT jsonb_build_object(
    'available', true,
    'segment', v_segment,
    'peerCount', v_org_count,
    'avgTicketMedio', CASE WHEN SUM(vendas) > 0 THEN ROUND(SUM(revenue) / SUM(vendas), 2) ELSE 0 END,
    'avgLeadsPerSeller', CASE WHEN SUM(team_size) > 0 THEN ROUND(SUM(leads)::NUMERIC / SUM(team_size), 1) ELSE 0 END,
    'avgConversionRate', CASE WHEN SUM(leads) > 0 THEN ROUND((SUM(vendas)::NUMERIC / SUM(leads)) * 100, 1) ELSE 0 END
  ) INTO result FROM peer_metrics;

  RETURN result;
END; $$;

GRANT EXECUTE ON FUNCTION public.get_segment_benchmark(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_segment_benchmark(UUID) TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 3.6 get_ranking_data
-- ────────────────────────────────────────────────────────────────────────────

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
  v_end_ts := ((make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date + time '23:59:59.999') AT TIME ZONE 'UTC';

  -- Ranking de Vendas (metric_type = 'sales' OR metric_type IS NULL)
  WITH sales_agg AS (
    SELECT COALESCE((pe.metadata->>'responsible_id')::uuid, (pe.metadata->>'closer_id')::uuid) AS member_id,
           SUM(COALESCE((pe.metadata->>'sale_value')::numeric, 0))::numeric AS total_value,
           COUNT(*)::int AS conversions
    FROM public.pipeline_entries pe
    JOIN public.pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
    WHERE pe.organization_id = v_org_id
      AND pe.stage_key = 'vendido'
      AND COALESCE((pe.metadata->>'responsible_id')::uuid, (pe.metadata->>'closer_id')::uuid) IS NOT NULL
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

  -- Ranking de Reunioes (metric_type = 'meetings')
  -- Expand each meeting into rows for each role, then count DISTINCT meetings per member.
  WITH meetings_flat AS (
    SELECT pe.id AS meeting_id,
           unnest(ARRAY[
             (pe.metadata->>'responsible_id')::uuid,
             (pe.metadata->>'sdr_id')::uuid,
             (pe.metadata->>'closer_id')::uuid
           ]) AS member_id
    FROM public.pipeline_entries pe
    JOIN public.pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'confirmacao' AND pip.type = 'system'
    WHERE pe.organization_id = v_org_id
      AND pe.stage_key = 'compareceu'
      AND (
        ((pe.metadata->>'metrics_period_at') IS NOT NULL
         AND (pe.metadata->>'metrics_period_at')::timestamptz >= v_start_ts
         AND (pe.metadata->>'metrics_period_at')::timestamptz <= v_end_ts)
        OR ((pe.metadata->>'metrics_period_at') IS NULL
            AND pe.created_at >= v_start_ts AND pe.created_at <= v_end_ts)
      )
  ),
  meetings_agg AS (
    SELECT member_id,
           COUNT(DISTINCT meeting_id)::int AS total_meetings
    FROM meetings_flat
    WHERE member_id IS NOT NULL
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

GRANT EXECUTE ON FUNCTION public.get_ranking_data TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ranking_data TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 3.7 get_dashboard_metrics
-- ────────────────────────────────────────────────────────────────────────────

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
  -- 1. Total de leads criados no periodo
  SELECT COUNT(*) INTO v_total_leads
  FROM leads
  WHERE organization_id = p_org_id
    AND created_at >= p_start_date AND created_at <= p_end_date
    AND (p_filter_member_id IS NULL OR responsible_id = p_filter_member_id);

  -- 2. Tempo medio de resposta (chat-based)
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

  -- 3. Reunioes marcadas, comparecidas, no-show (via pipeline_entries + confirmacao)
  SELECT COUNT(*) INTO v_reunioes_marcadas
  FROM pipeline_entries pe
  JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'confirmacao' AND pip.type = 'system'
  WHERE pe.organization_id = p_org_id
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) >= p_start_date
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) <= p_end_date
    AND (p_filter_member_id IS NULL
         OR (pe.metadata->>'sdr_id')::uuid = p_filter_member_id
         OR (pe.metadata->>'closer_id')::uuid = p_filter_member_id
         OR (pe.metadata->>'responsible_id')::uuid = p_filter_member_id);
  v_funnel_reunioes_marcadas := v_reunioes_marcadas;

  SELECT COUNT(*) INTO v_reunioes_comparecidas
  FROM pipeline_entries pe
  JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'confirmacao' AND pip.type = 'system'
  WHERE pe.organization_id = p_org_id AND pe.stage_key = 'compareceu'
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) >= p_start_date
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) <= p_end_date
    AND (p_filter_member_id IS NULL
         OR (pe.metadata->>'sdr_id')::uuid = p_filter_member_id
         OR (pe.metadata->>'closer_id')::uuid = p_filter_member_id
         OR (pe.metadata->>'responsible_id')::uuid = p_filter_member_id);
  v_funnel_compareceu := v_reunioes_comparecidas;

  SELECT COUNT(*) INTO v_no_show
  FROM pipeline_entries pe
  JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'confirmacao' AND pip.type = 'system'
  WHERE pe.organization_id = p_org_id
    AND (pe.metadata->>'meeting_date')::timestamptz < NOW()
    AND pe.stage_key IN ('remarcar', 'perdido')
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) >= p_start_date
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) <= p_end_date
    AND (p_filter_member_id IS NULL
         OR (pe.metadata->>'sdr_id')::uuid = p_filter_member_id
         OR (pe.metadata->>'closer_id')::uuid = p_filter_member_id
         OR (pe.metadata->>'responsible_id')::uuid = p_filter_member_id);

  SELECT COUNT(*) INTO v_finalizados_data_passada
  FROM pipeline_entries pe
  JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'confirmacao' AND pip.type = 'system'
  WHERE pe.organization_id = p_org_id
    AND (pe.metadata->>'meeting_date')::timestamptz < NOW()
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) >= p_start_date
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) <= p_end_date
    AND (p_filter_member_id IS NULL
         OR (pe.metadata->>'sdr_id')::uuid = p_filter_member_id
         OR (pe.metadata->>'closer_id')::uuid = p_filter_member_id
         OR (pe.metadata->>'responsible_id')::uuid = p_filter_member_id);

  IF v_finalizados_data_passada > 0 THEN
    v_taxa_no_show := ROUND((v_no_show::NUMERIC / v_finalizados_data_passada) * 100);
  END IF;

  -- 4. Propostas enviadas (via pipeline_entries + propostas)
  SELECT COUNT(*) INTO v_propostas_enviadas
  FROM pipeline_entries pe
  JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
  WHERE pe.organization_id = p_org_id
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) >= p_start_date
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) <= p_end_date
    AND (p_filter_member_id IS NULL
         OR (pe.metadata->>'closer_id')::uuid = p_filter_member_id
         OR (pe.metadata->>'responsible_id')::uuid = p_filter_member_id);
  v_funnel_propostas := v_propostas_enviadas;

  -- 5. Vendas (vendido no periodo)
  SELECT COUNT(*) INTO v_funnel_vendas
  FROM pipeline_entries pe
  JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
  WHERE pe.organization_id = p_org_id AND pe.stage_key = 'vendido'
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.closed_at) >= p_start_date
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.closed_at) <= p_end_date
    AND (p_filter_member_id IS NULL
         OR (pe.metadata->>'closer_id')::uuid = p_filter_member_id
         OR (pe.metadata->>'responsible_id')::uuid = p_filter_member_id);
  v_novos_clientes := v_funnel_vendas;

  -- Taxa de conversao corrigida
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
    AND (p_filter_member_id IS NULL
         OR (pe.metadata->>'closer_id')::uuid = p_filter_member_id
         OR (pe.metadata->>'responsible_id')::uuid = p_filter_member_id);

  IF v_total_in_pipe > 0 THEN
    v_taxa_conversao := ROUND((v_funnel_vendas::NUMERIC / v_total_in_pipe) * 100, 1);
  END IF;

  -- Revenue breakdown (includes pipe_proposta_items for MRR/projeto split)
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
      AND (p_filter_member_id IS NULL
           OR (pe.metadata->>'closer_id')::uuid = p_filter_member_id
           OR (pe.metadata->>'responsible_id')::uuid = p_filter_member_id)
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
      AND (p_filter_member_id IS NULL
           OR (pe.metadata->>'closer_id')::uuid = p_filter_member_id
           OR (pe.metadata->>'responsible_id')::uuid = p_filter_member_id)
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

-- ────────────────────────────────────────────────────────────────────────────
-- 3.8 get_leads_team_no_response
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_leads_team_no_response(
  p_organization_id UUID,
  p_delay_hours INTEGER,
  p_delay_minutes INTEGER,
  p_pipe_type TEXT DEFAULT NULL,
  p_filter_stages TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  lead_id UUID,
  last_incoming_at TIMESTAMPTZ,
  phone_number TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH last_msg AS (
    SELECT
      wm.lead_id,
      wm.phone_number,
      wm.direction,
      wm.timestamp,
      ROW_NUMBER() OVER (PARTITION BY wm.lead_id ORDER BY wm.timestamp DESC) AS rn
    FROM whatsapp_messages wm
    WHERE wm.organization_id = p_organization_id
      AND wm.lead_id IS NOT NULL
      AND wm.phone_number IS NOT NULL
  )
  SELECT
    lm.lead_id,
    lm.timestamp AS last_incoming_at,
    lm.phone_number
  FROM last_msg lm
  INNER JOIN leads l ON l.id = lm.lead_id
  WHERE lm.rn = 1
    AND lm.direction = 'incoming'
    AND (NOW() - lm.timestamp) >= (
      (p_delay_hours || ' hours')::interval +
      (p_delay_minutes || ' minutes')::interval
    )
    -- Filtro opcional por pipe_type
    AND (p_pipe_type IS NULL OR (
      CASE p_pipe_type
        WHEN 'whatsapp' THEN l.pipe_whatsapp IS NOT NULL
        WHEN 'confirmacao' THEN EXISTS (
          SELECT 1 FROM pipeline_entries pe
          JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'confirmacao' AND pip.type = 'system'
          WHERE pe.lead_id = l.id
        )
        WHEN 'propostas' THEN EXISTS (
          SELECT 1 FROM pipeline_entries pe
          JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
          WHERE pe.lead_id = l.id
        )
        ELSE TRUE
      END
    ))
    -- Filtro opcional por etapas especificas
    AND (p_filter_stages IS NULL OR array_length(p_filter_stages, 1) IS NULL OR (
      CASE p_pipe_type
        WHEN 'whatsapp' THEN l.pipe_whatsapp::text = ANY(p_filter_stages)
        WHEN 'confirmacao' THEN EXISTS (
          SELECT 1 FROM pipeline_entries pe
          JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'confirmacao' AND pip.type = 'system'
          WHERE pe.lead_id = l.id AND pe.stage_key = ANY(p_filter_stages)
        )
        WHEN 'propostas' THEN EXISTS (
          SELECT 1 FROM pipeline_entries pe
          JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
          WHERE pe.lead_id = l.id AND pe.stage_key = ANY(p_filter_stages)
        )
        ELSE TRUE
      END
    ));
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3.9 get_leads_no_response_from_lead
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_leads_no_response_from_lead(
  p_organization_id UUID,
  p_delay_hours INTEGER,
  p_delay_minutes INTEGER,
  p_pipe_type TEXT DEFAULT NULL,
  p_filter_stages TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  lead_id UUID,
  last_outgoing_at TIMESTAMPTZ,
  phone_number TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH last_msg AS (
    SELECT
      wm.lead_id,
      wm.phone_number,
      wm.direction,
      wm.timestamp,
      ROW_NUMBER() OVER (PARTITION BY wm.lead_id ORDER BY wm.timestamp DESC) AS rn
    FROM whatsapp_messages wm
    WHERE wm.organization_id = p_organization_id
      AND wm.lead_id IS NOT NULL
      AND wm.phone_number IS NOT NULL
  )
  SELECT
    lm.lead_id,
    lm.timestamp AS last_outgoing_at,
    lm.phone_number
  FROM last_msg lm
  INNER JOIN leads l ON l.id = lm.lead_id
  WHERE lm.rn = 1
    AND lm.direction = 'outgoing'
    AND (NOW() - lm.timestamp) >= (
      (p_delay_hours || ' hours')::interval +
      (p_delay_minutes || ' minutes')::interval
    )
    AND (p_pipe_type IS NULL OR (
      CASE p_pipe_type
        WHEN 'whatsapp' THEN l.pipe_whatsapp IS NOT NULL
        WHEN 'confirmacao' THEN EXISTS (
          SELECT 1 FROM pipeline_entries pe
          JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'confirmacao' AND pip.type = 'system'
          WHERE pe.lead_id = l.id
        )
        WHEN 'propostas' THEN EXISTS (
          SELECT 1 FROM pipeline_entries pe
          JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
          WHERE pe.lead_id = l.id
        )
        ELSE TRUE
      END
    ))
    AND (p_filter_stages IS NULL OR array_length(p_filter_stages, 1) IS NULL OR (
      CASE p_pipe_type
        WHEN 'whatsapp' THEN l.pipe_whatsapp::text = ANY(p_filter_stages)
        WHEN 'confirmacao' THEN EXISTS (
          SELECT 1 FROM pipeline_entries pe
          JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'confirmacao' AND pip.type = 'system'
          WHERE pe.lead_id = l.id AND pe.stage_key = ANY(p_filter_stages)
        )
        WHEN 'propostas' THEN EXISTS (
          SELECT 1 FROM pipeline_entries pe
          JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
          WHERE pe.lead_id = l.id AND pe.stage_key = ANY(p_filter_stages)
        )
        ELSE TRUE
      END
    ));
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3.10 get_leads_not_confirmed
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_leads_not_confirmed(
  p_organization_id UUID,
  p_hours_before_meeting INTEGER,
  p_minutes_before_meeting INTEGER,
  p_filter_stages TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  lead_id UUID,
  meeting_date TIMESTAMPTZ,
  confirmacao_id UUID,
  current_status TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pe.lead_id,
    (pe.metadata->>'meeting_date')::timestamptz AS meeting_date,
    pe.id AS confirmacao_id,
    pe.stage_key AS current_status
  FROM pipeline_entries pe
  JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'confirmacao' AND pip.type = 'system'
  INNER JOIN leads l ON l.id = pe.lead_id AND l.organization_id = p_organization_id
  WHERE (pe.metadata->>'meeting_date')::timestamptz IS NOT NULL
    -- Reuniao esta no futuro mas dentro da janela de alerta
    AND (pe.metadata->>'meeting_date')::timestamptz > NOW()
    AND (pe.metadata->>'meeting_date')::timestamptz <= NOW() + (
      (p_hours_before_meeting || ' hours')::interval +
      (p_minutes_before_meeting || ' minutes')::interval
    )
    -- Status indica que NAO confirmou ainda
    AND pe.stage_key NOT IN ('confirmada_no_dia', 'compareceu', 'perdido')
    -- Filtro opcional por etapas
    AND (p_filter_stages IS NULL OR array_length(p_filter_stages, 1) IS NULL
         OR pe.stage_key = ANY(p_filter_stages));
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3.11 get_pipeline_velocity
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_pipeline_velocity(
  p_pipeline_type text,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_result jsonb;
BEGIN
  SELECT tm.organization_id INTO v_org_id
  FROM team_members tm WHERE tm.user_id = auth.uid() LIMIT 1;

  IF v_org_id IS NULL THEN RETURN '{}'::jsonb; END IF;

  -- Velocity = (num_deals * win_rate * avg_value) / avg_cycle_days
  WITH won_deals AS (
    SELECT
      COUNT(*) AS num_won,
      COALESCE(AVG((pe.metadata->>'sale_value')::numeric), 0) AS avg_value
    FROM pipeline_entries pe
    JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
    WHERE pe.organization_id = v_org_id
      AND pe.stage_key = 'vendido'
      AND (p_start_date IS NULL OR pe.created_at >= p_start_date)
      AND (p_end_date IS NULL OR pe.created_at <= p_end_date)
  ),
  all_deals AS (
    SELECT COUNT(*) AS total
    FROM pipeline_entries pe
    JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
    WHERE pe.organization_id = v_org_id
      AND pe.stage_key IN ('vendido', 'perdido')
      AND (p_start_date IS NULL OR pe.created_at >= p_start_date)
  )
  SELECT jsonb_build_object(
    'num_won', COALESCE(w.num_won, 0),
    'total_closed', COALESCE(a.total, 0),
    'win_rate', CASE WHEN a.total > 0 THEN ROUND(w.num_won::numeric / a.total * 100, 1) ELSE 0 END,
    'avg_deal_value', ROUND(w.avg_value::numeric, 2)
  ) INTO v_result
  FROM won_deals w, all_deals a;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3.12 get_revenue_attribution
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_revenue_attribution(
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL
)
RETURNS TABLE(
  origin text,
  lead_count bigint,
  won_count bigint,
  total_revenue numeric,
  avg_deal_value numeric,
  conversion_rate numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT tm.organization_id INTO v_org_id
  FROM team_members tm WHERE tm.user_id = auth.uid() LIMIT 1;

  IF v_org_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    COALESCE(l.origin, 'unknown') AS origin,
    COUNT(DISTINCT l.id) AS lead_count,
    COUNT(DISTINCT pe.id) FILTER (WHERE pe.stage_key = 'vendido') AS won_count,
    COALESCE(SUM((pe.metadata->>'sale_value')::numeric) FILTER (WHERE pe.stage_key = 'vendido'), 0)::numeric AS total_revenue,
    COALESCE(AVG((pe.metadata->>'sale_value')::numeric) FILTER (WHERE pe.stage_key = 'vendido'), 0)::numeric AS avg_deal_value,
    CASE
      WHEN COUNT(DISTINCT l.id) > 0
      THEN ROUND(COUNT(DISTINCT pe.id) FILTER (WHERE pe.stage_key = 'vendido')::numeric / COUNT(DISTINCT l.id) * 100, 1)
      ELSE 0
    END AS conversion_rate
  FROM leads l
  LEFT JOIN pipeline_entries pe ON pe.lead_id = l.id
    AND EXISTS (
      SELECT 1 FROM pipelines pip
      WHERE pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
    )
    AND (p_start_date IS NULL OR pe.created_at >= p_start_date)
    AND (p_end_date IS NULL OR pe.created_at <= p_end_date)
  WHERE l.organization_id = v_org_id
    AND l.deleted_at IS NULL
    AND (p_start_date IS NULL OR l.created_at >= p_start_date)
    AND (p_end_date IS NULL OR l.created_at <= p_end_date)
  GROUP BY l.origin
  ORDER BY total_revenue DESC;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3.13 get_win_loss_analysis
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_win_loss_analysis(
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL
)
RETURNS TABLE(
  loss_reason text,
  count bigint,
  total_value numeric,
  pct numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_total bigint;
BEGIN
  SELECT tm.organization_id INTO v_org_id
  FROM team_members tm WHERE tm.user_id = auth.uid() LIMIT 1;

  IF v_org_id IS NULL THEN RETURN; END IF;

  SELECT COUNT(*) INTO v_total
  FROM pipeline_entries pe
  JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
  WHERE pe.organization_id = v_org_id
    AND pe.stage_key = 'perdido'
    AND (p_start_date IS NULL OR pe.created_at >= p_start_date)
    AND (p_end_date IS NULL OR pe.created_at <= p_end_date);

  RETURN QUERY
  SELECT
    COALESCE(pe.metadata->>'loss_reason', 'Nao informado') AS reason,
    COUNT(*) AS cnt,
    COALESCE(SUM((pe.metadata->>'sale_value')::numeric), 0)::numeric AS total_val,
    CASE WHEN v_total > 0
      THEN ROUND(COUNT(*)::numeric / v_total * 100, 1)
      ELSE 0
    END AS pct
  FROM pipeline_entries pe
  JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
  WHERE pe.organization_id = v_org_id
    AND pe.stage_key = 'perdido'
    AND (p_start_date IS NULL OR pe.created_at >= p_start_date)
    AND (p_end_date IS NULL OR pe.created_at <= p_end_date)
  GROUP BY pe.metadata->>'loss_reason'
  ORDER BY cnt DESC;
END;
$$;

-- ============================================================================
-- Section 4: Re-point Foreign Keys
-- ============================================================================

-- pipe_proposta_items: pipe_proposta_id -> pipeline_entries(id)
ALTER TABLE public.pipe_proposta_items
  DROP CONSTRAINT IF EXISTS pipe_proposta_items_pipe_proposta_id_fkey;
ALTER TABLE public.pipe_proposta_items
  ADD CONSTRAINT pipe_proposta_items_pipeline_entry_id_fkey
  FOREIGN KEY (pipe_proposta_id) REFERENCES public.pipeline_entries(id) ON DELETE CASCADE;

-- tinyerp_order_mappings: pipe_proposta_id -> pipeline_entries(id)
ALTER TABLE public.tinyerp_order_mappings
  DROP CONSTRAINT IF EXISTS tinyerp_order_mappings_pipe_proposta_id_fkey;
ALTER TABLE public.tinyerp_order_mappings
  ADD CONSTRAINT tinyerp_order_mappings_pipeline_entry_id_fkey
  FOREIGN KEY (pipe_proposta_id) REFERENCES public.pipeline_entries(id) ON DELETE CASCADE;

-- commissions: pipe_proposta_id -> pipeline_entries(id)
ALTER TABLE public.commissions
  DROP CONSTRAINT IF EXISTS commissions_pipe_proposta_id_fkey;
ALTER TABLE public.commissions
  ADD CONSTRAINT commissions_pipeline_entry_id_fkey
  FOREIGN KEY (pipe_proposta_id) REFERENCES public.pipeline_entries(id) ON DELETE SET NULL;

-- upsell_orders: pipe_proposta_id -> pipeline_entries(id)
ALTER TABLE public.upsell_orders
  DROP CONSTRAINT IF EXISTS upsell_orders_pipe_proposta_id_fkey;
ALTER TABLE public.upsell_orders
  ADD CONSTRAINT upsell_orders_pipeline_entry_id_fkey
  FOREIGN KEY (pipe_proposta_id) REFERENCES public.pipeline_entries(id) ON DELETE SET NULL;

-- acoes_do_dia: proposta_id -> pipeline_entries(id)
ALTER TABLE public.acoes_do_dia
  DROP CONSTRAINT IF EXISTS acoes_do_dia_proposta_id_fkey;
ALTER TABLE public.acoes_do_dia
  ADD CONSTRAINT acoes_do_dia_proposta_id_pipeline_entries_fkey
  FOREIGN KEY (proposta_id) REFERENCES public.pipeline_entries(id) ON DELETE SET NULL;

-- acoes_do_dia: confirmacao_id -> pipeline_entries(id)
ALTER TABLE public.acoes_do_dia
  DROP CONSTRAINT IF EXISTS acoes_do_dia_confirmacao_id_fkey;
ALTER TABLE public.acoes_do_dia
  ADD CONSTRAINT acoes_do_dia_confirmacao_id_pipeline_entries_fkey
  FOREIGN KEY (confirmacao_id) REFERENCES public.pipeline_entries(id) ON DELETE SET NULL;

-- ============================================================================
-- Section 5: Drop legacy tables
-- ============================================================================

DROP TABLE IF EXISTS public.pipe_whatsapp CASCADE;
DROP TABLE IF EXISTS public.pipe_confirmacao CASCADE;
DROP TABLE IF EXISTS public.pipe_propostas CASCADE;

-- ============================================================================
-- Section 6: Attach new whatsapp cache trigger
-- ============================================================================

DROP TRIGGER IF EXISTS trg_sync_whatsapp_stage_to_lead ON public.pipeline_entries;
CREATE TRIGGER trg_sync_whatsapp_stage_to_lead
  AFTER INSERT OR UPDATE OR DELETE ON public.pipeline_entries
  FOR EACH ROW EXECUTE FUNCTION public.sync_pipeline_entry_to_lead_pipe_whatsapp();

-- ============================================================================
-- Validation
-- ============================================================================

DO $$
BEGIN
  -- Verify legacy tables are gone
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pipe_whatsapp') THEN
    RAISE EXCEPTION 'VALIDATION FAILED: pipe_whatsapp still exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pipe_confirmacao') THEN
    RAISE EXCEPTION 'VALIDATION FAILED: pipe_confirmacao still exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pipe_propostas') THEN
    RAISE EXCEPTION 'VALIDATION FAILED: pipe_propostas still exists';
  END IF;

  -- Verify sync functions are gone
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'sync_entries_to_legacy_pipes') THEN
    RAISE EXCEPTION 'VALIDATION FAILED: sync_entries_to_legacy_pipes still exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'sync_legacy_pipe_to_entries') THEN
    RAISE EXCEPTION 'VALIDATION FAILED: sync_legacy_pipe_to_entries still exists';
  END IF;

  -- Verify new trigger function exists
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'sync_pipeline_entry_to_lead_pipe_whatsapp') THEN
    RAISE EXCEPTION 'VALIDATION FAILED: sync_pipeline_entry_to_lead_pipe_whatsapp missing';
  END IF;

  -- Verify new trigger is attached
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sync_whatsapp_stage_to_lead') THEN
    RAISE EXCEPTION 'VALIDATION FAILED: trg_sync_whatsapp_stage_to_lead trigger missing';
  END IF;

  -- Verify FK re-pointing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'pipe_proposta_items_pipeline_entry_id_fkey'
      AND table_name = 'pipe_proposta_items'
  ) THEN
    RAISE EXCEPTION 'VALIDATION FAILED: pipe_proposta_items FK not re-pointed';
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: Phase 4 pipeline unification complete. Legacy tables dropped.';
END;
$$;

COMMIT;
