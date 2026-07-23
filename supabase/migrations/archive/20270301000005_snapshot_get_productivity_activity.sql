-- snapshot (ADR-0018): corpo VIVO de prod (jsjsmuncfkbsbzqzqhfq), capturado 2026-07-07
-- via pg_get_functiondef. Baseline verificada do SP-0.5 (#987) — NÃO é mudança.
-- Nota: reuniões já são event-sourced (meeting_events, ADR-0007); o bloco de venda
-- ainda carrega R3/R4/R5 (type='system', COALESCE de atribuição, sold_at por
-- fallback) — migrado no SP-3 (#1000).

CREATE OR REPLACE FUNCTION public.get_productivity_activity(p_org_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_seller uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_novos       int := 0;
  v_marcadas    int := 0;
  v_realizadas  int := 0;
  v_vendido     int := 0;
BEGIN
  PERFORM public.assert_org_access(p_org_id);

  SELECT count(*) INTO v_novos
  FROM public.leads l
  WHERE l.organization_id = p_org_id
    AND l.deleted_at IS NULL
    AND l.created_at >= p_from
    AND l.created_at <= p_to
    AND (p_seller IS NULL OR COALESCE(l.responsible_id, l.sdr_id) = p_seller);

  SELECT count(*) INTO v_marcadas
  FROM public.meeting_events me
  WHERE me.organization_id = p_org_id
    AND me.event_type = 'meeting_booked'
    AND me.occurred_at >= p_from
    AND me.occurred_at <= p_to
    AND (p_seller IS NULL OR me.pre_sale_responsible_id = p_seller);

  SELECT count(*) INTO v_realizadas
  FROM public.meeting_events me
  WHERE me.organization_id = p_org_id
    AND me.event_type = 'meeting_held'
    AND me.meeting_date IS NOT NULL
    AND me.meeting_date >= p_from
    AND me.meeting_date <= p_to
    AND (p_seller IS NULL OR me.pre_sale_responsible_id = p_seller);

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
