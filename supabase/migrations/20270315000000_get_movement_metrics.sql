-- 20270315000000_get_movement_metrics.sql
--
-- Painel "Movimentações no período" (Performance) — leitor purpose-built que
-- conta MOVIMENTAÇÕES por DATA DO EVENTO (quando o fato aconteceu no caderno),
-- NÃO por data de criação do lead. Isolado do ranking/gamificação; sem gate de
-- feature flag (os cadernos meeting_events/sale_events são populados por trigger,
-- independente da flag canonical_metrics).
--
-- SEMÂNTICA (3 contagens, cada uma no seu caderno canônico):
--   · marcadas     → meeting_events.event_type='meeting_booked', ancorada em
--                    occurred_at (momento da MARCAÇÃO) dentro de [p_start, p_end].
--   · comparecidas → meeting_events.event_type='meeting_held', ancorada em
--                    COALESCE(meeting_date, occurred_at) (data da REUNIÃO;
--                    fallback pro registro quando a data da reunião é desconhecida).
--   · vendido      → sale_events.event_type='sale', ancorada em sold_at, LÍQUIDO
--                    de estornos (anti-join com sale_reversed — mesma leitura de
--                    get_sales_metrics/#995). Devolve contagem + Σ sale_value.
--
-- INTERVALO: [p_start, p_end] FECHADO nas duas pontas. O frontend
--   (computeSaudePeriodRange) entrega fronteiras de dia em UTC com p_end =
--   23:59:59.999, então <= p_end é o corte correto e casa 1:1 com a UI.
--
-- ATRIBUIÇÃO (p_member_id opcional): 1 chave canônica por papel, jamais OR-chain
--   (ADR-0017 §5 / R5). Reunião → pre_sale_responsible_id (SDR snapshot no evento);
--   venda → sale_responsible_id (Closer snapshot no evento). NULL = org inteira.
--
-- RECEITA: SUM(sale_value) ignora NULL (valor desconhecido, nunca 0 fabricado);
--   COALESCE(...,0) no agregado = 0 reais CONHECIDOS quando não há venda.
--
-- Guard: PERFORM assert_org_access(p_org_id) — mesma fronteira de tenant das
--   demais RPCs de métrica. SECURITY DEFINER (roda sob authenticated com RLS on).
-- search_path pinado public, extensions (gotcha: 58 fns já sofreram sem pin).

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
    -- marcadas: reunião MARCADA por data da marcação (occurred_at)
    (SELECT COUNT(*)::int
       FROM public.meeting_events me
      WHERE me.organization_id = p_org_id
        AND me.event_type = 'meeting_booked'
        AND me.occurred_at >= p_start
        AND me.occurred_at <= p_end
        AND (p_member_id IS NULL OR me.pre_sale_responsible_id = p_member_id)),

    -- comparecidas: reunião REALIZADA por data da reunião (fallback registro)
    (SELECT COUNT(*)::int
       FROM public.meeting_events me
      WHERE me.organization_id = p_org_id
        AND me.event_type = 'meeting_held'
        AND COALESCE(me.meeting_date, me.occurred_at) >= p_start
        AND COALESCE(me.meeting_date, me.occurred_at) <= p_end
        AND (p_member_id IS NULL OR me.pre_sale_responsible_id = p_member_id)),

    -- vendido (contagem): sale líquido de estorno por sold_at
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

    -- vendido (receita): Σ sale_value do mesmo conjunto líquido
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
  'Painel Movimentações no período (Performance) — conta marcadas (meeting_booked '
  'por occurred_at), comparecidas (meeting_held por coalesce(meeting_date,occurred_at)) '
  'e vendido (sale por sold_at, líquido de estorno: count + Σ sale_value) num '
  'intervalo [p_start,p_end] fechado. Atribuição single-key opcional por p_member_id '
  '(pre_sale_responsible_id / sale_responsible_id). Guard assert_org_access.';

REVOKE ALL ON FUNCTION public.get_movement_metrics(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_movement_metrics(uuid, timestamptz, timestamptz, uuid)
  TO authenticated, service_role;
