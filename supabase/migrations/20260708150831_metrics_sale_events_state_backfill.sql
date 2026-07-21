-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260708150831  name: metrics_sale_events_state_backfill
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- 20270302000100 (U2, ADR-0017 §7) — backfill governado de venda por estado atual
CREATE FUNCTION public.fn_backfill_parse_sale_value(p_raw text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v numeric;
BEGIN
  v := NULLIF(p_raw, '')::numeric;
  IF v IS NULL OR v < 0 THEN RETURN NULL; END IF;
  RETURN v;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_backfill_parse_sale_value(text) FROM PUBLIC;
COMMENT ON FUNCTION public.fn_backfill_parse_sale_value(text) IS 'U2 / ADR-0017 §7 — parse honesto de metadata->>sale_value: ausente/vazio/malformado/negativo → NULL (nunca 0).';

CREATE FUNCTION public.fn_backfill_state_sales()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_inserted integer;
BEGIN
  INSERT INTO public.sale_events
    (organization_id, lead_id, pipeline_id, stage_key, stage_event_id, event_type, reversed_event_id, sold_at, sale_value, currency, revenue_stream, sale_responsible_id, pre_sale_responsible_id, actor, source)
  SELECT
    pe.organization_id, pe.lead_id, pe.pipeline_id, pe.stage_key, se.id,
    CASE WHEN public.metric_stage_role(pe.organization_id, pe.pipeline_id, pe.stage_key) = 'won' THEN 'sale' ELSE 'sale_lost' END,
    NULL,
    COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at),
    public.fn_backfill_parse_sale_value(pe.metadata->>'sale_value'),
    CASE WHEN COALESCE(upper(pe.metadata->>'currency'), '') ~ '^[A-Z]{3}$' THEN upper(pe.metadata->>'currency') ELSE 'BRL' END,
    CASE WHEN EXISTS (SELECT 1 FROM public.upsell_clients uc WHERE uc.organization_id = pe.organization_id AND uc.lead_id = pe.lead_id AND uc.is_active) THEN 'carteira' ELSE 'novo_negocio' END,
    COALESCE(l.sale_responsible_id, l.closer_id),
    l.pre_sale_responsible_id, NULL, 'backfill'
  FROM public.pipeline_entries pe
  JOIN public.leads l ON l.id = pe.lead_id AND l.organization_id = pe.organization_id
  LEFT JOIN LATERAL (
    SELECT e.id FROM public.pipeline_stage_events e
    WHERE e.lead_id = pe.lead_id AND e.pipeline_id = pe.pipeline_id
    ORDER BY e.occurred_at DESC, e.created_at DESC LIMIT 1
  ) se ON true
  WHERE pe.lead_id IS NOT NULL
    AND public.metric_stage_role(pe.organization_id, pe.pipeline_id, pe.stage_key) IN ('won', 'lost')
    AND NOT EXISTS (
      SELECT 1 FROM public.sale_events s
      WHERE s.lead_id = pe.lead_id AND s.pipeline_id = pe.pipeline_id AND s.event_type IN ('sale', 'sale_lost')
        AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = s.id)
    );
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_backfill_state_sales() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_backfill_state_sales() TO service_role;
COMMENT ON FUNCTION public.fn_backfill_state_sales() IS 'U2 / ADR-0017 §7 — backfill governado de venda por estado atual. 1 sale/sale_lost por entry viva parada em won/lost, ancorado no stage_changed_at real. Idempotente. Re-executável por ops.';

DO $backfill$
DECLARE v_n integer;
BEGIN
  SELECT public.fn_backfill_state_sales() INTO v_n;
  RAISE NOTICE 'U2 backfill de venda por estado: % linha(s) emitida(s).', v_n;
END;
$backfill$;
