-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260714191215  name: get_movement_metrics
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

CREATE OR REPLACE FUNCTION public.get_movement_metrics(
  p_org_id    uuid,
  p_start     timestamptz,
  p_end       timestamptz,
  p_member_id uuid DEFAULT NULL
)
RETURNS TABLE (
  marcadas        integer,
  comparecidas    integer,
  vendido_count   integer,
  vendido_receita numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.assert_org_access(p_org_id);

  RETURN QUERY
  SELECT
    (SELECT COUNT(*)::int
       FROM public.meeting_events me
      WHERE me.organization_id = p_org_id
        AND me.event_type = 'meeting_booked'
        AND me.occurred_at >= p_start
        AND me.occurred_at <= p_end
        AND (p_member_id IS NULL OR me.pre_sale_responsible_id = p_member_id)),

    (SELECT COUNT(*)::int
       FROM public.meeting_events me
      WHERE me.organization_id = p_org_id
        AND me.event_type = 'meeting_held'
        AND COALESCE(me.meeting_date, me.occurred_at) >= p_start
        AND COALESCE(me.meeting_date, me.occurred_at) <= p_end
        AND (p_member_id IS NULL OR me.pre_sale_responsible_id = p_member_id)),

    (SELECT COUNT(*)::int
       FROM public.sale_events w
      WHERE w.organization_id = p_org_id
        AND w.event_type = 'sale'
        AND w.sold_at >= p_start
        AND w.sold_at <= p_end
        AND (p_member_id IS NULL OR w.sale_responsible_id = p_member_id)
        AND NOT EXISTS (
          SELECT 1 FROM public.sale_events r
          WHERE r.event_type = 'sale_reversed'
            AND r.reversed_event_id = w.id)),

    (SELECT COALESCE(SUM(w.sale_value), 0)
       FROM public.sale_events w
      WHERE w.organization_id = p_org_id
        AND w.event_type = 'sale'
        AND w.sold_at >= p_start
        AND w.sold_at <= p_end
        AND (p_member_id IS NULL OR w.sale_responsible_id = p_member_id)
        AND NOT EXISTS (
          SELECT 1 FROM public.sale_events r
          WHERE r.event_type = 'sale_reversed'
            AND r.reversed_event_id = w.id));
END;
$$;

COMMENT ON FUNCTION public.get_movement_metrics(uuid, timestamptz, timestamptz, uuid) IS
  'Painel Movimentacoes no periodo (Performance) - conta marcadas (meeting_booked por occurred_at), comparecidas (meeting_held por coalesce(meeting_date,occurred_at)) e vendido (sale por sold_at, liquido de estorno: count + soma sale_value) num intervalo [p_start,p_end] fechado. Atribuicao single-key opcional por p_member_id. Guard assert_org_access.';

REVOKE ALL ON FUNCTION public.get_movement_metrics(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_movement_metrics(uuid, timestamptz, timestamptz, uuid)
  TO authenticated, service_role;
