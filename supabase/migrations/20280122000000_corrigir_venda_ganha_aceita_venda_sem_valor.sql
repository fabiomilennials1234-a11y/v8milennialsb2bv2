-- corrigir_venda_ganha aceita venda ganha SEM valor.
--
-- Orgs poupadas do rollout de valor obrigatório (rollout_exige_valor_venda)
-- fecham negócio com sale_value NULL. Corrigir esse valor estourava 23502 em
-- deal_sale_corrections.before_value (NOT NULL) porque a RPC gravava
-- v_old.sale_value cru. Mesma convenção de ajustar_pedido_ganho: ausência
-- vira 0 no "antes" da trilha de auditoria. Única linha alterada.
CREATE OR REPLACE FUNCTION public.corrigir_venda_ganha(p_deal_id uuid, p_expected_updated_at timestamp with time zone, p_value numeric, p_date date, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_deal public.deals%ROWTYPE;
  v_old public.sale_events%ROWTYPE;
  v_reversal public.sale_events%ROWTYPE;
  v_replacement public.sale_events%ROWTYPE;
  v_order public.upsell_orders%ROWTYPE;
  v_count integer;
  v_timezone text;
  v_sold_at timestamptz;
  v_stream text;
  v_correction uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_deal FROM public.deals WHERE id = p_deal_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.assert_org_member(v_deal.organization_id);
  IF NOT COALESCE(public.is_master_user(), false) AND NOT EXISTS (
    SELECT 1 FROM public.team_members m WHERE m.user_id = auth.uid()
      AND m.organization_id = v_deal.organization_id AND m.is_active AND m.role IN ('admin','member')
  ) THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  IF NOT COALESCE(public.can_link_or_read_lead(v_deal.source_lead_id, v_deal.organization_id), false) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF v_deal.outcome IS DISTINCT FROM 'won' THEN RAISE EXCEPTION 'sale_not_won' USING ERRCODE = '22023'; END IF;
  IF p_expected_updated_at IS NULL OR v_deal.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'sale_state_changed' USING ERRCODE = 'PT409';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'correction_reason_required' USING ERRCODE = '22023';
  END IF;
  IF p_value IS NULL OR NOT (p_value > 0 AND p_value <= 9999999999.99) OR round(p_value,2) <> p_value THEN
    RAISE EXCEPTION 'invalid_sale_value' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(NULLIF(timezone,''),'America/Sao_Paulo') INTO v_timezone
    FROM public.organizations WHERE id = v_deal.organization_id;
  IF p_date IS NULL OR p_date > (now() AT TIME ZONE v_timezone)::date THEN
    RAISE EXCEPTION 'invalid_sale_date' USING ERRCODE = '22023';
  END IF;
  IF v_deal.metadata->>'historical_sale' = 'true' THEN
    RETURN public.corrigir_venda_historica(p_deal_id,p_expected_updated_at,p_value,p_date,p_reason);
  END IF;

  SELECT count(*) INTO v_count FROM public.sale_events s
    WHERE s.deal_id = v_deal.id AND s.organization_id = v_deal.organization_id AND s.event_type = 'sale'
      AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.reversed_event_id=s.id AND r.event_type='sale_reversed');
  IF v_count <> 1 THEN RAISE EXCEPTION 'sale_link_ambiguous' USING ERRCODE = '22023'; END IF;
  SELECT s.* INTO v_old FROM public.sale_events s
    WHERE s.deal_id=v_deal.id AND s.organization_id=v_deal.organization_id AND s.event_type='sale'
      AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.reversed_event_id=s.id AND r.event_type='sale_reversed')
    FOR UPDATE;
  IF v_old.producer NOT IN ('funnel','deal') OR v_old.origin_record_id IS NOT NULL OR EXISTS (
    SELECT 1 FROM public.pipeline_entries pe WHERE pe.deal_id=v_deal.id AND pe.organization_id=v_deal.organization_id
      AND (NULLIF(pe.metadata->>'tiny_order_id','') IS NOT NULL OR pe.metadata->>'external_source' IN ('toth','tiny','omie'))
  ) THEN RAISE EXCEPTION 'order_erp_linked' USING ERRCODE = '42501'; END IF;

  -- Não divergir o total dos produtos: nesse caso o valor é ajustado pelo
  -- formulário existente de quantidades/preços; a data pode ser corrigida aqui.
  PERFORM 1 FROM public.deal_items WHERE deal_id=v_deal.id ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.deal_items WHERE deal_id=v_deal.id) AND
     p_value IS DISTINCT FROM (SELECT round(sum(total),2) FROM public.deal_items WHERE deal_id=v_deal.id) THEN
    RAISE EXCEPTION 'sale_value_from_items' USING ERRCODE = '22023';
  END IF;
  v_count := 0;
  FOR v_order IN SELECT o.* FROM public.upsell_orders o
    WHERE o.organization_id=v_deal.organization_id
      AND ((o.external_source='funnel_sale_event' AND o.external_id=v_old.id::text)
        OR o.pipe_proposta_id IN (SELECT id FROM public.pipeline_entries WHERE deal_id=v_deal.id AND organization_id=v_deal.organization_id))
    FOR UPDATE
  LOOP
    v_count := v_count+1;
    IF v_order.source IN ('erp','historical') OR v_order.tiny_order_id IS NOT NULL
      OR v_order.external_source IN ('toth','tiny','omie')
      OR public.carteira_erp_source(v_order.id,v_order.organization_id,v_order.tiny_order_id,v_order.external_source) IS NOT NULL THEN
      RAISE EXCEPTION 'order_erp_linked' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  IF v_count > 1 THEN RAISE EXCEPTION 'sale_link_ambiguous' USING ERRCODE = '22023'; END IF;

  -- Alterar só o valor conserva a hora da venda; alterar o dia usa meio-dia na org.
  v_sold_at := CASE WHEN p_date=(v_old.sold_at AT TIME ZONE v_timezone)::date THEN v_old.sold_at
    ELSE (p_date + time '12:00') AT TIME ZONE v_timezone END;
  IF v_old.sold_at=v_sold_at AND v_old.sale_value=p_value AND v_deal.value IS NOT DISTINCT FROM p_value
    AND v_deal.closed_at IS NOT DISTINCT FROM v_sold_at AND v_deal.outcome_at IS NOT DISTINCT FROM v_sold_at
    AND (v_count=0 OR (v_order.sale_value=p_value AND v_order.sold_at=v_sold_at)) THEN
    RETURN jsonb_build_object('deal_id',v_deal.id,'changed',false);
  END IF;
  v_stream := public.metric_revenue_stream(v_deal.organization_id,v_old.lead_id,v_sold_at,v_old.id);
  v_reversal := v_old;
  v_reversal.id := gen_random_uuid(); v_reversal.event_type := 'sale_reversed';
  v_reversal.reversed_event_id := v_old.id; v_reversal.adjusts_sale_id := v_old.id;
  v_reversal.created_at := now(); v_reversal.actor := auth.uid(); v_reversal.source := 'ui'; v_reversal.stage_event_id := NULL;
  v_replacement := v_old;
  v_replacement.id := gen_random_uuid(); v_replacement.adjusts_sale_id := v_old.id;
  v_replacement.sold_at := v_sold_at; v_replacement.sale_value := p_value; v_replacement.revenue_stream := v_stream;
  v_replacement.created_at := now(); v_replacement.actor := auth.uid(); v_replacement.source := 'ui'; v_replacement.stage_event_id := NULL;
  PERFORM set_config('torque.sale_correction_event',v_replacement.id::text,true);
  INSERT INTO public.sale_events SELECT * FROM unnest(ARRAY[v_reversal,v_replacement]);
  PERFORM set_config('torque.sale_correction_event','',true);

  UPDATE public.deals SET value=p_value,closed_at=v_sold_at,outcome_at=v_sold_at,updated_at=clock_timestamp() WHERE id=v_deal.id;
  UPDATE public.pipeline_entries SET metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('sale_value',p_value)
    WHERE deal_id=v_deal.id AND organization_id=v_deal.organization_id;
  IF v_count=1 THEN
    UPDATE public.upsell_orders SET sale_value=p_value,sold_at=v_sold_at,
      origin=CASE WHEN v_stream='novo_negocio' THEN 'new_business' ELSE 'upsell' END,
      external_id=CASE WHEN external_source='funnel_sale_event' THEN v_replacement.id::text ELSE external_id END
      WHERE id=v_order.id AND organization_id=v_deal.organization_id;
    UPDATE public.upsell_clients SET first_sale_at=(SELECT min(sold_at) FROM public.upsell_orders WHERE client_id=v_order.client_id AND approval_status='approved')
      WHERE id=v_order.client_id AND organization_id=v_deal.organization_id;
  END IF;
  INSERT INTO public.deal_sale_corrections(organization_id,deal_id,original_sale_id,replacement_sale_id,actor_id,
    reason,before_value,after_value,before_sold_at,after_sold_at)
  VALUES(v_deal.organization_id,v_deal.id,v_old.id,v_replacement.id,auth.uid(),btrim(p_reason),COALESCE(v_old.sale_value,v_deal.value,0),p_value,v_old.sold_at,v_sold_at)
    RETURNING id INTO v_correction;
  RETURN jsonb_build_object('deal_id',v_deal.id,'value',p_value,'sold_at',v_sold_at,'correction_id',v_correction,'changed',true);
END;
$function$;

REVOKE ALL ON FUNCTION public.corrigir_venda_ganha(uuid,timestamptz,numeric,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.corrigir_venda_ganha(uuid,timestamptz,numeric,date,text) TO authenticated;
