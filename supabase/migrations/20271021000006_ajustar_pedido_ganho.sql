-- Ajustar o mesmo negócio ganho, sem reabrir, trocar a data ou duplicar pedido.
-- Criada via CLI em 2026-09-14; ordenada após a cadeia legada com versões futuras.
-- O caderno permanece append-only: estorno + substituição no período original.
BEGIN;

ALTER TABLE public.sale_events ADD COLUMN adjusts_sale_id uuid REFERENCES public.sale_events(id) ON DELETE CASCADE;
CREATE INDEX sale_events_adjusts_sale_idx ON public.sale_events(adjusts_sale_id) WHERE adjusts_sale_id IS NOT NULL;
ALTER TABLE public.sale_events ADD CONSTRAINT sale_adjustment_kind CHECK (
  adjusts_sale_id IS NULL OR (event_type IN ('sale', 'sale_reversed') AND deal_id IS NOT NULL)
);

CREATE TABLE public.deal_order_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  original_sale_id uuid NOT NULL REFERENCES public.sale_events(id) ON DELETE CASCADE,
  replacement_sale_id uuid REFERENCES public.sale_events(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  before_value numeric NOT NULL,
  after_value numeric NOT NULL CHECK (after_value > 0),
  before_items jsonb NOT NULL,
  after_items jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deal_order_adjustments_deal_idx ON public.deal_order_adjustments(organization_id, deal_id, created_at DESC);
CREATE INDEX deal_order_adjustments_original_idx ON public.deal_order_adjustments(original_sale_id);
CREATE INDEX deal_order_adjustments_replacement_idx ON public.deal_order_adjustments(replacement_sale_id) WHERE replacement_sale_id IS NOT NULL;
ALTER TABLE public.deal_order_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY deal_order_adjustments_read ON public.deal_order_adjustments FOR SELECT TO authenticated
  USING ((public.is_master_user() OR organization_id IN (SELECT public.get_my_organization_ids()))
    AND EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_order_adjustments.deal_id
      AND d.organization_id = deal_order_adjustments.organization_id
      AND public.can_link_or_read_lead(d.source_lead_id, d.organization_id)));
REVOKE ALL ON public.deal_order_adjustments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.deal_order_adjustments TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_sale_events_force_sold_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_original public.sale_events%ROWTYPE;
BEGIN
  IF NEW.adjusts_sale_id IS NOT NULL THEN
    SELECT * INTO v_original FROM public.sale_events WHERE id = NEW.adjusts_sale_id;
    IF NOT FOUND OR v_original.event_type <> 'sale'
       OR v_original.organization_id IS DISTINCT FROM NEW.organization_id
       OR v_original.deal_id IS DISTINCT FROM NEW.deal_id
       OR v_original.lead_id IS DISTINCT FROM NEW.lead_id
       OR (NEW.event_type = 'sale_reversed' AND NEW.reversed_event_id IS DISTINCT FROM v_original.id) THEN
      RAISE EXCEPTION 'invalid_sale_adjustment' USING ERRCODE = '22023';
    END IF;
    NEW.sold_at := v_original.sold_at;
  ELSIF NEW.source <> 'backfill' AND NEW.producer <> 'carteira' THEN
    NEW.sold_at := now();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_sale_events_force_sold_at() FROM PUBLIC, anon, authenticated;

-- A RPC atualiza o pedido espelhado no lugar. O fluxo normal de admissão
-- apagaria o pedido antigo no estorno e criaria outro na substituição.
-- A admissão está em produção; alguns ambientes antigos ainda não a têm.
DO $$ BEGIN
  IF to_regprocedure('public.fn_carteira_admite_venda()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_carteira_admite_venda ON public.sale_events;
    CREATE TRIGGER trg_carteira_admite_venda AFTER INSERT ON public.sale_events
    FOR EACH ROW WHEN (NEW.producer = 'funnel' AND NEW.event_type IN ('sale', 'sale_reversed') AND NEW.adjusts_sale_id IS NULL)
    EXECUTE FUNCTION public.fn_carteira_admite_venda();
  END IF;
END $$;

CREATE FUNCTION public.ajustar_pedido_ganho(
  p_deal_id uuid, p_expected_updated_at timestamptz, p_value numeric,
  p_items jsonb, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_deal public.deals%ROWTYPE;
  v_sale public.sale_events%ROWTYPE;
  v_before jsonb; v_after jsonb; v_value numeric; v_count integer;
  v_reversal uuid; v_replacement uuid; v_event public.sale_events%ROWTYPE; v_reversed public.sale_events%ROWTYPE;
  v_order public.upsell_orders%ROWTYPE;
  v_adjustment uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_deal FROM public.deals WHERE id = p_deal_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.assert_org_access(v_deal.organization_id);
  IF NOT COALESCE(public.can_link_or_read_lead(v_deal.source_lead_id, v_deal.organization_id), false) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF v_deal.outcome <> 'won' THEN RAISE EXCEPTION 'order_not_won' USING ERRCODE = '22023'; END IF;
  IF p_expected_updated_at IS NULL OR v_deal.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'order_state_changed' USING ERRCODE = '40001';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'adjustment_reason_required' USING ERRCODE = '22023';
  END IF;

  -- Só vínculo exato pelo negócio; nunca inferir o pedido pelo nome do cliente.
  SELECT count(*) INTO v_count FROM public.sale_events s
  WHERE s.deal_id = v_deal.id AND s.organization_id = v_deal.organization_id
    AND s.event_type = 'sale' AND NOT EXISTS (
      SELECT 1 FROM public.sale_events r WHERE r.reversed_event_id = s.id AND r.event_type = 'sale_reversed');
  IF v_count <> 1 THEN RAISE EXCEPTION 'sale_link_ambiguous' USING ERRCODE = '22023'; END IF;
  SELECT s.* INTO v_sale FROM public.sale_events s
  WHERE s.deal_id = v_deal.id AND s.organization_id = v_deal.organization_id
    AND s.event_type = 'sale' AND NOT EXISTS (
      SELECT 1 FROM public.sale_events r WHERE r.reversed_event_id = s.id AND r.event_type = 'sale_reversed') FOR UPDATE;
  IF v_sale.producer NOT IN ('funnel', 'deal') OR v_sale.origin_record_id IS NOT NULL THEN
    RAISE EXCEPTION 'order_erp_linked' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.pipeline_entries pe
    WHERE pe.deal_id = v_deal.id AND pe.organization_id = v_deal.organization_id
      AND (NULLIF(pe.metadata->>'tiny_order_id', '') IS NOT NULL
        OR pe.metadata->>'external_source' IN ('toth', 'tiny', 'omie'))
  ) THEN RAISE EXCEPTION 'order_erp_linked' USING ERRCODE = '42501'; END IF;
  FOR v_order IN SELECT o.* FROM public.upsell_orders o
    WHERE o.organization_id = v_deal.organization_id
      AND ((o.external_source = 'funnel_sale_event' AND o.external_id = v_sale.id::text)
        OR o.pipe_proposta_id IN (SELECT id FROM public.pipeline_entries WHERE deal_id = v_deal.id)) FOR UPDATE
  LOOP
    IF v_order.source IN ('erp', 'historical') OR v_order.tiny_order_id IS NOT NULL
      OR v_order.external_source IN ('toth', 'tiny', 'omie')
      OR public.carteira_erp_source(v_order.id, v_order.organization_id, v_order.tiny_order_id, v_order.external_source) IS NOT NULL THEN
      RAISE EXCEPTION 'order_erp_linked' USING ERRCODE = '42501';
    END IF;
  END LOOP;

  PERFORM 1 FROM public.deal_items WHERE deal_id = v_deal.id ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.deal_items WHERE deal_id = v_deal.id
    AND organization_id IS DISTINCT FROM v_deal.organization_id) THEN
    RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'quantity', quantity, 'unit_price', unit_price,
    'discount_percent', discount_percent) ORDER BY id), '[]'::jsonb) INTO v_before
  FROM public.deal_items WHERE deal_id = v_deal.id AND organization_id = v_deal.organization_id;
  IF jsonb_array_length(v_before) > 0 THEN
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) <> jsonb_array_length(v_before) THEN
      RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
    END IF;
    SELECT count(DISTINCT x.id) INTO v_count FROM jsonb_to_recordset(p_items)
      AS x(id uuid, quantity numeric, unit_price numeric, discount_percent numeric)
    JOIN public.deal_items i ON i.id = x.id AND i.deal_id = v_deal.id AND i.organization_id = v_deal.organization_id
    WHERE x.quantity > 0 AND x.quantity < 'Infinity'::numeric AND x.unit_price >= 0 AND x.unit_price < 'Infinity'::numeric
      AND x.discount_percent BETWEEN 0 AND 100;
    IF v_count <> jsonb_array_length(v_before) THEN RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023'; END IF;
    UPDATE public.deal_items i SET quantity = x.quantity, unit_price = x.unit_price, discount_percent = x.discount_percent
    FROM jsonb_to_recordset(p_items) AS x(id uuid, quantity numeric, unit_price numeric, discount_percent numeric)
    WHERE i.id = x.id AND i.deal_id = v_deal.id AND i.organization_id = v_deal.organization_id
      AND (i.quantity, i.unit_price, i.discount_percent) IS DISTINCT FROM (x.quantity, x.unit_price, x.discount_percent);
    SELECT round(sum(total), 2) INTO v_value FROM public.deal_items
      WHERE deal_id = v_deal.id AND organization_id = v_deal.organization_id;
  ELSE
    IF p_items IS NOT NULL AND p_items <> '[]'::jsonb THEN RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023'; END IF;
    v_value := round(p_value, 2);
  END IF;
  IF v_value IS NULL OR NOT (v_value > 0 AND v_value < 1000000000000) THEN
    RAISE EXCEPTION 'invalid_sale_value' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'quantity', quantity, 'unit_price', unit_price,
    'discount_percent', discount_percent) ORDER BY id), '[]'::jsonb) INTO v_after
  FROM public.deal_items WHERE deal_id = v_deal.id AND organization_id = v_deal.organization_id;
  IF v_after = v_before AND v_deal.value IS NOT DISTINCT FROM v_value AND v_sale.sale_value IS NOT DISTINCT FROM v_value THEN
    RETURN jsonb_build_object('deal_id', v_deal.id, 'changed', false);
  END IF;
  UPDATE public.deals SET value = v_value, updated_at = clock_timestamp() WHERE id = v_deal.id;
  UPDATE public.pipeline_entries SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('sale_value', v_value)
    WHERE deal_id = v_deal.id AND organization_id = v_deal.organization_id;

  IF v_sale.sale_value IS DISTINCT FROM v_value THEN
    v_reversal := gen_random_uuid(); v_replacement := gen_random_uuid();
    v_event := v_sale;
    v_event.id := v_reversal; v_event.event_type := 'sale_reversed'; v_event.reversed_event_id := v_sale.id;
    v_event.adjusts_sale_id := v_sale.id; v_event.created_at := now(); v_event.actor := auth.uid();
    v_event.source := 'ui'; v_event.stage_event_id := NULL;
    v_reversed := v_event;
    v_event.id := v_replacement; v_event.event_type := 'sale'; v_event.reversed_event_id := NULL; v_event.sale_value := v_value;
    -- Uma instrução: os triggers AFTER enxergam o par completo. O cliente
    -- nunca passa transitoriamente por "sem venda" entre os dois eventos.
    INSERT INTO public.sale_events SELECT * FROM unnest(ARRAY[v_reversed, v_event]);
  END IF;
  -- Mesmo ID, data, aprovação e responsável. O trigger de métricas recalcula a carteira.
  UPDATE public.upsell_orders SET sale_value = v_value,
    external_id = COALESCE(v_replacement::text, external_id)
  WHERE organization_id = v_deal.organization_id AND external_source = 'funnel_sale_event' AND external_id = v_sale.id::text;

  INSERT INTO public.deal_order_adjustments (organization_id, deal_id, original_sale_id, replacement_sale_id,
    actor_id, reason, before_value, after_value, before_items, after_items)
  VALUES (v_deal.organization_id, v_deal.id, v_sale.id, v_replacement, auth.uid(), btrim(p_reason),
    COALESCE(v_deal.value, 0), v_value, v_before, v_after) RETURNING id INTO v_adjustment;
  RETURN jsonb_build_object('deal_id', v_deal.id, 'value', v_value, 'adjustment_id', v_adjustment, 'changed', true);
END;
$$;
REVOKE ALL ON FUNCTION public.ajustar_pedido_ganho(uuid, timestamptz, numeric, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ajustar_pedido_ganho(uuid, timestamptz, numeric, jsonb, text) TO authenticated;
COMMIT;
