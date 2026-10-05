-- Corrigir data e valor de uma venda histórica: negócio, caderno e pedido juntos.
-- O trigger guard_historical_order_edit existe para impedir a edição solta de um
-- dos três; esta RPC é o fluxo que ele esperava, e é a única que o atravessa.
BEGIN;

CREATE OR REPLACE FUNCTION public.guard_historical_order_edit() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.source = 'historical' AND (
    NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.source IS DISTINCT FROM OLD.source
    OR NEW.approval_status IS DISTINCT FROM OLD.approval_status
    OR ((NEW.sale_value IS DISTINCT FROM OLD.sale_value OR NEW.sold_at IS DISTINCT FROM OLD.sold_at)
      AND COALESCE(current_setting('torque.historical_correction', true), '') <> OLD.id::text)
  ) THEN RAISE EXCEPTION 'order_historical_readonly' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE public.historical_sale_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.upsell_orders(id) ON DELETE CASCADE,
  original_sale_id uuid NOT NULL REFERENCES public.sale_events(id) ON DELETE CASCADE,
  replacement_sale_id uuid REFERENCES public.sale_events(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  before_value numeric NOT NULL,
  after_value numeric NOT NULL CHECK (after_value > 0),
  before_sold_at timestamptz NOT NULL,
  after_sold_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX historical_sale_corrections_deal_idx
  ON public.historical_sale_corrections(organization_id, deal_id, created_at DESC);
ALTER TABLE public.historical_sale_corrections ENABLE ROW LEVEL SECURITY;
CREATE POLICY historical_sale_corrections_read ON public.historical_sale_corrections
  FOR SELECT TO authenticated
  USING ((public.is_master_user() OR organization_id IN (SELECT public.get_my_organization_ids()))
    AND EXISTS (SELECT 1 FROM public.deals d WHERE d.id = historical_sale_corrections.deal_id
      AND d.organization_id = historical_sale_corrections.organization_id
      AND public.can_link_or_read_lead(d.source_lead_id, d.organization_id)));
REVOKE ALL ON public.historical_sale_corrections FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.historical_sale_corrections TO authenticated;

CREATE FUNCTION public.corrigir_venda_historica(
  p_deal_id uuid, p_expected_updated_at timestamptz, p_value numeric, p_date date, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_deal public.deals%ROWTYPE;
  v_order public.upsell_orders%ROWTYPE;
  v_old public.sale_events%ROWTYPE;
  v_reversal public.sale_events%ROWTYPE;
  v_replacement public.sale_events%ROWTYPE;
  v_timezone text;
  v_value numeric;
  v_sold_at timestamptz;
  v_stream text;
  v_count integer;
  v_correction uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_deal FROM public.deals WHERE id = p_deal_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.assert_org_member(v_deal.organization_id);
  IF NOT COALESCE(public.is_master_user(), false) AND NOT EXISTS (
    SELECT 1 FROM public.team_members m WHERE m.user_id = auth.uid()
      AND m.organization_id = v_deal.organization_id AND m.is_active
      AND m.role IN ('admin', 'member')
  ) THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  IF NOT COALESCE(public.can_link_or_read_lead(v_deal.source_lead_id, v_deal.organization_id), false) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_deal.metadata->>'historical_sale', '') <> 'true' OR v_deal.outcome IS DISTINCT FROM 'won' THEN
    RAISE EXCEPTION 'not_historical_sale' USING ERRCODE = '22023';
  END IF;
  IF p_expected_updated_at IS NULL OR v_deal.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'sale_state_changed' USING ERRCODE = 'PT409';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'correction_reason_required' USING ERRCODE = '22023';
  END IF;
  v_value := p_value;
  IF v_value IS NULL OR v_value <= 0 OR v_value > 9999999999.99 OR round(v_value, 2) <> v_value THEN
    RAISE EXCEPTION 'invalid_sale_value' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(NULLIF(timezone, ''), 'America/Sao_Paulo') INTO v_timezone
    FROM public.organizations WHERE id = v_deal.organization_id;
  IF p_date IS NULL OR p_date > (now() AT TIME ZONE v_timezone)::date THEN
    RAISE EXCEPTION 'invalid_sale_date' USING ERRCODE = '22023';
  END IF;
  v_sold_at := (p_date + time '12:00') AT TIME ZONE v_timezone;

  -- Só o vínculo exato gravado pelo registro: negócio -> pedido -> uma venda viva no caderno.
  SELECT * INTO v_order FROM public.upsell_orders
    WHERE id = NULLIF(v_deal.metadata->>'order_id', '')::uuid
      AND organization_id = v_deal.organization_id AND source = 'historical' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale_link_ambiguous' USING ERRCODE = '22023'; END IF;
  SELECT count(*) INTO v_count FROM public.sale_events s
    WHERE s.deal_id = v_deal.id AND s.organization_id = v_deal.organization_id
      AND s.event_type = 'sale' AND NOT EXISTS (
        SELECT 1 FROM public.sale_events r WHERE r.reversed_event_id = s.id AND r.event_type = 'sale_reversed');
  IF v_count <> 1 THEN RAISE EXCEPTION 'sale_link_ambiguous' USING ERRCODE = '22023'; END IF;
  SELECT s.* INTO v_old FROM public.sale_events s
    WHERE s.deal_id = v_deal.id AND s.organization_id = v_deal.organization_id
      AND s.event_type = 'sale' AND NOT EXISTS (
        SELECT 1 FROM public.sale_events r WHERE r.reversed_event_id = s.id AND r.event_type = 'sale_reversed')
    FOR UPDATE;
  IF v_old.producer <> 'carteira' THEN RAISE EXCEPTION 'sale_link_ambiguous' USING ERRCODE = '22023'; END IF;

  IF v_old.sold_at = v_sold_at AND v_old.sale_value = v_value AND v_deal.value IS NOT DISTINCT FROM v_value
     AND v_order.sold_at = v_sold_at AND v_order.sale_value = v_value THEN
    RETURN jsonb_build_object('deal_id', v_deal.id, 'changed', false);
  END IF;

  -- O caderno é append-only: estorno no período original e venda nova no período corrigido,
  -- na mesma instrução, para o cliente nunca ficar sem venda entre os dois eventos.
  v_stream := public.metric_revenue_stream(v_deal.organization_id, v_old.lead_id, v_sold_at, v_old.id);
  v_reversal := v_old;
  v_reversal.id := gen_random_uuid(); v_reversal.event_type := 'sale_reversed';
  v_reversal.reversed_event_id := v_old.id; v_reversal.adjusts_sale_id := v_old.id;
  v_reversal.origin_record_id := gen_random_uuid(); v_reversal.created_at := now();
  v_reversal.actor := auth.uid(); v_reversal.source := 'backfill'; v_reversal.stage_event_id := NULL;
  v_replacement := v_old;
  v_replacement.id := gen_random_uuid(); v_replacement.reversed_event_id := NULL;
  v_replacement.adjusts_sale_id := NULL; v_replacement.origin_record_id := gen_random_uuid();
  v_replacement.sold_at := v_sold_at; v_replacement.sale_value := v_value;
  v_replacement.revenue_stream := v_stream; v_replacement.created_at := now();
  v_replacement.actor := auth.uid(); v_replacement.source := 'backfill';
  INSERT INTO public.sale_events SELECT * FROM unnest(ARRAY[v_reversal, v_replacement]);

  PERFORM set_config('torque.historical_correction', v_order.id::text, true);
  UPDATE public.upsell_orders SET sale_value = v_value, sold_at = v_sold_at,
    origin = CASE WHEN v_stream = 'novo_negocio' THEN 'new_business' ELSE 'upsell' END
    WHERE id = v_order.id;
  PERFORM set_config('torque.historical_correction', '', true);

  UPDATE public.deals SET value = v_value, closed_at = v_sold_at, outcome_at = v_sold_at,
    title = CASE WHEN title = 'Venda registrada em ' || to_char((v_deal.closed_at AT TIME ZONE v_timezone)::date, 'DD/MM/YYYY')
      THEN 'Venda registrada em ' || to_char(p_date, 'DD/MM/YYYY') ELSE title END,
    updated_at = clock_timestamp()
    WHERE id = v_deal.id;

  UPDATE public.upsell_clients SET first_sale_at =
    (SELECT min(sold_at) FROM public.upsell_orders WHERE client_id = v_order.client_id AND approval_status = 'approved')
    WHERE id = v_order.client_id AND organization_id = v_deal.organization_id;
  UPDATE public.upsell_clients c SET tipo_cliente_tempo = st.stage_key
    FROM LATERAL (SELECT s.stage_key FROM public.pipeline_stages s
      WHERE s.organization_id = v_deal.organization_id AND s.pipeline_type = 'upsell_base'
        AND s.is_active AND s.auto_move_min_days IS NOT NULL AND s.auto_move_max_days IS NOT NULL
        AND (SELECT days_since_last_order FROM public.upsell_clients WHERE id = v_order.client_id)
          BETWEEN s.auto_move_min_days AND s.auto_move_max_days
      ORDER BY s.position LIMIT 1) st
    WHERE c.id = v_order.client_id AND c.organization_id = v_deal.organization_id;

  INSERT INTO public.historical_sale_corrections(organization_id, deal_id, order_id, original_sale_id,
    replacement_sale_id, actor_id, reason, before_value, after_value, before_sold_at, after_sold_at)
  VALUES(v_deal.organization_id, v_deal.id, v_order.id, v_old.id, v_replacement.id, auth.uid(),
    btrim(p_reason), v_old.sale_value, v_value, v_old.sold_at, v_sold_at)
  RETURNING id INTO v_correction;
  RETURN jsonb_build_object('deal_id', v_deal.id, 'value', v_value, 'sold_at', v_sold_at,
    'correction_id', v_correction, 'changed', true);
END;
$$;
REVOKE ALL ON FUNCTION public.corrigir_venda_historica(uuid, timestamptz, numeric, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corrigir_venda_historica(uuid, timestamptz, numeric, date, text) TO authenticated;
COMMIT;
