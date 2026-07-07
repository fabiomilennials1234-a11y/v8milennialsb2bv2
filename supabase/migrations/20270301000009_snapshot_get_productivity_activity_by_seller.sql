-- snapshot (ADR-0018): corpo VIVO de prod (jsjsmuncfkbsbzqzqhfq), capturado 2026-07-07
-- via pg_get_functiondef. Baseline verificada do SP-0.5 (#987) — NÃO é mudança.
-- Nota: bloco de venda carrega R3/R4/R5 (documentado na auditoria) — migrado no SP-3 (#1000).

CREATE OR REPLACE FUNCTION public.get_productivity_activity_by_seller(p_org_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
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
    SELECT COALESCE(l.responsible_id, l.sdr_id) AS sid, count(*) AS c
    FROM public.leads l
    WHERE l.organization_id = p_org_id
      AND l.deleted_at IS NULL
      AND l.created_at >= p_from AND l.created_at <= p_to
      AND COALESCE(l.responsible_id, l.sdr_id) IS NOT NULL
    GROUP BY 1
  ),
  vendido AS (
    SELECT s.closer_id AS sid, count(*) AS c
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
      AND s.sold_at >= p_from AND s.sold_at <= p_to
      AND s.closer_id IS NOT NULL
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
