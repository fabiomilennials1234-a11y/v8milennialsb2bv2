-- snapshot (ADR-0018): corpo VIVO de prod (jsjsmuncfkbsbzqzqhfq), capturado 2026-07-07
-- via pg_get_functiondef. Baseline verificada do SP-0.5 (#987) — NÃO é mudança.

CREATE OR REPLACE FUNCTION public.get_productivity_activity_leads(p_org_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_count_type text, p_seller uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
