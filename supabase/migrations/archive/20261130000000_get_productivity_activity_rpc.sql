-- Produtividade — Activity-in-Period Indicator (ADR-0013, PRD #891).
--
-- OPPOSITE of get_funnel_health (cohort-by-creation): every count here is keyed
-- to the DATE OF THE ACTION ITSELF, never to the Lead's creation/entry date.
-- A Lead created in May whose meeting was booked in June counts in JUNE. This is
-- the whole point and the bug that motivated the feature.
--
-- Four counts, each over a free [from,to] window, org-wide by default with an
-- optional single-seller narrow:
--   • Novos leads            — leads.created_at in window. Attribution = responsável.
--   • Reuniões Marcadas      — meeting_events 'meeting_booked' keyed by occurred_at.
--                              Attribution = pre_sale_responsible_id (snapshot). Reschedule
--                              dedup already guaranteed by the event model (ADR-0007, >30d rule).
--   • Reuniões Realizadas    — meeting_events 'meeting_held' keyed by meeting_date (NOT
--                              occurred_at). Attribution = pre_sale_responsible_id.
--   • Vendido                — Lead currently in stage 'vendido' on the system 'propostas'
--                              pipe (state-based sold, per ADR-0007), dated by the DURABLE
--                              move timestamp from lead_history (preferred), with the entry's
--                              closed_at / stage_changed_at as deterministic fallback.
--                              Attribution = Closer (sale_responsible_id, legacy fallback).
--
-- Vendido timestamp source — decision (ADR-0013 escape-hatch resolution):
--   lead_history IS used as the primary durable dated source, covering BOTH write paths to
--   'vendido' that exist in the codebase:
--     - automation/workflow/copilot/cron → trigger fn_log_pipeline_stage_change_history
--       writes action='stage_changed', metadata.to_stage='vendido' (structured).
--     - manual move (frontend PropostasContext) → action='proposal_status_changed',
--       description 'Status alterado para "Vendido"' (text; matched case-insensitively).
--   When no durable lead_history row exists (very old sales pre-trigger, or a manual move
--   whose logAction failed), we fall back to the entry's closed_at then stage_changed_at so
--   no real sale is dropped. The dedicated sale_events table (ADR-0007 escape hatch) is NOT
--   needed now; the description-match on the manual path is a known, locale-bound limitation
--   tracked as a follow-up.
--
-- Security: SECURITY DEFINER (bypasses RLS) guarded by assert_org_access(p_org_id) — same
-- pattern as the analytics RPCs (20261114000011). Multi-tenant: org A never sees org B.

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

  -- Novos leads — by created_at. Attribution = responsável (legacy sdr fallback).
  SELECT count(*) INTO v_novos
  FROM public.leads l
  WHERE l.organization_id = p_org_id
    AND l.deleted_at IS NULL
    AND l.created_at >= p_from
    AND l.created_at <= p_to
    AND (p_seller IS NULL OR COALESCE(l.responsible_id, l.sdr_id) = p_seller);

  -- Reuniões Marcadas — meeting_booked by occurred_at. Attribution = Pré-vendas.
  SELECT count(*) INTO v_marcadas
  FROM public.meeting_events me
  WHERE me.organization_id = p_org_id
    AND me.event_type = 'meeting_booked'
    AND me.occurred_at >= p_from
    AND me.occurred_at <= p_to
    AND (p_seller IS NULL OR me.pre_sale_responsible_id = p_seller);

  -- Reuniões Realizadas — meeting_held by meeting_date. Attribution = Pré-vendas.
  SELECT count(*) INTO v_realizadas
  FROM public.meeting_events me
  WHERE me.organization_id = p_org_id
    AND me.event_type = 'meeting_held'
    AND me.meeting_date IS NOT NULL
    AND me.meeting_date >= p_from
    AND me.meeting_date <= p_to
    AND (p_seller IS NULL OR me.pre_sale_responsible_id = p_seller);

  -- Vendido — state-based sold, dated by durable move. Attribution = Closer.
  SELECT count(*) INTO v_vendido
  FROM (
    SELECT
      pe.lead_id,
      COALESCE(l.sale_responsible_id, l.closer_id, (pe.metadata->>'closer_id')::uuid) AS closer_id,
      COALESCE(
        (
          SELECT min(lh.created_at)
          FROM public.lead_history lh
          WHERE lh.lead_id = pe.lead_id
            AND lh.organization_id = p_org_id
            AND (
                 (lh.action = 'stage_changed' AND lh.metadata->>'to_stage' = 'vendido')
              OR (lh.action = 'proposal_status_changed' AND lh.description ILIKE '%vendido%')
            )
        ),
        pe.closed_at,
        pe.stage_changed_at
      ) AS sold_at
    FROM public.pipeline_entries pe
    JOIN public.pipelines pip
      ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
    JOIN public.leads l
      ON l.id = pe.lead_id AND l.deleted_at IS NULL
    WHERE pe.organization_id = p_org_id
      AND pe.stage_key = 'vendido'
  ) s
  WHERE s.sold_at IS NOT NULL
    AND s.sold_at >= p_from
    AND s.sold_at <= p_to
    AND (p_seller IS NULL OR s.closer_id = p_seller);

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


-- Drill companion — per-Lead rows behind a single count (#893). Same date semantics,
-- same window, same seller narrow. p_count_type ∈
-- ('novos_leads','reunioes_marcadas','reunioes_realizadas','vendido').
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
      LEFT JOIN public.team_members tm ON tm.id = COALESCE(l.responsible_id, l.sdr_id)
      WHERE l.organization_id = p_org_id
        AND l.deleted_at IS NULL
        AND l.created_at >= p_from
        AND l.created_at <= p_to
        AND (p_seller IS NULL OR COALESCE(l.responsible_id, l.sdr_id) = p_seller)
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
    SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'action_at') DESC), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT jsonb_build_object(
               'lead_id',     s.lead_id,
               'lead_name',   s.lead_name,
               'company',     s.company,
               'seller_id',   tm.id,
               'seller_name', tm.name,
               'action_at',   s.sold_at
             ) AS r
      FROM (
        SELECT
          pe.lead_id,
          l.name    AS lead_name,
          l.company AS company,
          COALESCE(l.sale_responsible_id, l.closer_id, (pe.metadata->>'closer_id')::uuid) AS closer_id,
          COALESCE(
            (
              SELECT min(lh.created_at)
              FROM public.lead_history lh
              WHERE lh.lead_id = pe.lead_id
                AND lh.organization_id = p_org_id
                AND (
                     (lh.action = 'stage_changed' AND lh.metadata->>'to_stage' = 'vendido')
                  OR (lh.action = 'proposal_status_changed' AND lh.description ILIKE '%vendido%')
                )
            ),
            pe.closed_at,
            pe.stage_changed_at
          ) AS sold_at
        FROM public.pipeline_entries pe
        JOIN public.pipelines pip
          ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
        JOIN public.leads l
          ON l.id = pe.lead_id AND l.deleted_at IS NULL
        WHERE pe.organization_id = p_org_id
          AND pe.stage_key = 'vendido'
      ) s
      LEFT JOIN public.team_members tm ON tm.id = s.closer_id
      WHERE s.sold_at IS NOT NULL
        AND s.sold_at >= p_from
        AND s.sold_at <= p_to
        AND (p_seller IS NULL OR s.closer_id = p_seller)
    ) q;

  ELSE
    RAISE EXCEPTION 'invalid p_count_type: %', p_count_type USING ERRCODE = 'P0001';
  END IF;

  RETURN v_rows;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_productivity_activity_leads(uuid, timestamptz, timestamptz, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_productivity_activity_leads(uuid, timestamptz, timestamptz, text, uuid) TO authenticated, service_role;
