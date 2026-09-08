-- Registro atômico e idempotente de compras anteriores ao CRM, sem posição em funil.
CREATE INDEX deals_historical_sales_by_lead ON public.deals(organization_id, source_lead_id)
  WHERE metadata->>'historical_sale' = 'true' AND deleted_at IS NULL AND won = true;
ALTER TABLE public.upsell_orders DROP CONSTRAINT upsell_orders_source_check;
ALTER TABLE public.upsell_orders ADD CONSTRAINT upsell_orders_source_check
  CHECK (source IN ('pipe', 'manual', 'erp', 'copilot', 'csv_import', 'historical'));

-- A edição genérica de pedidos não corrige o ledger nem o negócio vinculado.
-- Preserve o registro histórico até existir um fluxo de correção dos três juntos.
CREATE FUNCTION public.guard_historical_order_edit() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.source = 'historical' AND (
    NEW.sale_value IS DISTINCT FROM OLD.sale_value OR NEW.sold_at IS DISTINCT FROM OLD.sold_at
    OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.source IS DISTINCT FROM OLD.source
    OR NEW.approval_status IS DISTINCT FROM OLD.approval_status
  ) THEN RAISE EXCEPTION 'order_historical_readonly' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_historical_order_edit() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_historical_order_edit BEFORE UPDATE ON public.upsell_orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_historical_order_edit();
CREATE TABLE public.historical_sale_batches (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  lead_id uuid NOT NULL REFERENCES public.leads(id),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  sales jsonb NOT NULL,
  deal_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.historical_sale_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.historical_sale_batches FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.historical_sale_batches TO authenticated;
CREATE POLICY tenant_isolation_select ON public.historical_sale_batches FOR SELECT TO authenticated
USING ((organization_id IN (SELECT public.get_my_organization_ids()) OR public.is_master_user())
  AND public.can_link_or_read_lead(lead_id, organization_id));

CREATE OR REPLACE FUNCTION public.registrar_vendas_historicas(
  p_lead_id uuid, p_request_id uuid, p_sales jsonb
) RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead public.leads%ROWTYPE;
  v_batch public.historical_sale_batches%ROWTYPE;
  v_client uuid;
  v_deal uuid;
  v_order uuid;
  v_ids uuid[] := '{}';
  v_sale jsonb;
  v_value numeric;
  v_date date;
  v_sold_at timestamptz;
  v_timezone text;
  v_stream text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead indisponível.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_org_member(v_lead.organization_id);
  IF NOT COALESCE(public.is_master_user(), false) AND NOT EXISTS (
    SELECT 1 FROM public.team_members m WHERE m.user_id = auth.uid()
      AND m.organization_id = v_lead.organization_id AND m.is_active
      AND m.role IN ('admin', 'member')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para registrar vendas.' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(public.can_link_or_read_lead(p_lead_id, v_lead.organization_id), false) THEN
    RAISE EXCEPTION 'Sem acesso a este lead.' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_sales) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_sales) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Informe entre 1 e 100 vendas.' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(NULLIF(timezone, ''), 'America/Sao_Paulo') INTO v_timezone
    FROM public.organizations WHERE id = v_lead.organization_id;

  -- Valide a lista inteira antes de produzir qualquer venda.
  FOR v_sale IN SELECT value FROM jsonb_array_elements(p_sales) LOOP
    IF jsonb_typeof(v_sale) IS DISTINCT FROM 'object'
       OR COALESCE(v_sale->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$'
       OR jsonb_typeof(v_sale->'value') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Informe valor e data em todas as vendas.' USING ERRCODE = '22023';
    END IF;
    v_date := (v_sale->>'date')::date;
    v_value := (v_sale->>'value')::numeric;
    IF v_value <= 0 OR v_value > 9999999999.99 OR round(v_value, 2) <> v_value
       OR v_date > (now() AT TIME ZONE v_timezone)::date THEN
      RAISE EXCEPTION 'Use valor positivo com até dois decimais e data não futura.' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Serializa registros do mesmo lead, inclusive requisições com chaves diferentes.
  PERFORM 1 FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  INSERT INTO public.historical_sale_batches(id, organization_id, lead_id, created_by, sales)
    VALUES(p_request_id, v_lead.organization_id, p_lead_id, auth.uid(), p_sales)
    ON CONFLICT (id) DO NOTHING;
  SELECT * INTO v_batch FROM public.historical_sale_batches WHERE id = p_request_id FOR UPDATE;
  IF v_batch.organization_id <> v_lead.organization_id OR v_batch.lead_id <> p_lead_id
     OR v_batch.created_by <> auth.uid() OR v_batch.sales <> p_sales THEN
    RAISE EXCEPTION 'Este registro já foi usado com outra lista de vendas.' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_batch.deal_ids) > 0 THEN RETURN v_batch.deal_ids; END IF;

  INSERT INTO public.upsell_clients(organization_id, lead_id, name, company, email, phone,
    sale_responsible_id, pre_sale_responsible_id, closer_id)
  VALUES(v_lead.organization_id, p_lead_id, v_lead.name, v_lead.company, v_lead.email, v_lead.phone,
    v_lead.sale_responsible_id, v_lead.pre_sale_responsible_id, v_lead.sale_responsible_id)
  ON CONFLICT (organization_id, lead_id) DO NOTHING;
  SELECT id INTO v_client FROM public.upsell_clients
    WHERE organization_id = v_lead.organization_id AND lead_id = p_lead_id FOR UPDATE;

  -- Ordem cronológica faz a primeira compra ser aquisição e as seguintes recompra.
  FOR v_sale IN SELECT value FROM jsonb_array_elements(p_sales) ORDER BY value->>'date' LOOP
    v_date := (v_sale->>'date')::date;
    v_value := (v_sale->>'value')::numeric;
    v_sold_at := (v_date + time '12:00') AT TIME ZONE v_timezone;
    v_deal := gen_random_uuid();
    v_order := gen_random_uuid();
    INSERT INTO public.deals(id, organization_id, source_lead_id, title, value,
      owner_id, created_by, source, won, outcome, closed_at, outcome_at, outcome_source, metadata)
    VALUES(v_deal, v_lead.organization_id, p_lead_id, 'Venda registrada em ' || to_char(v_date, 'DD/MM/YYYY'),
      v_value, v_lead.sale_responsible_id, auth.uid(), 'import', true, 'won', v_sold_at, v_sold_at, 'ui',
      jsonb_build_object('historical_sale', true, 'batch_id', p_request_id, 'order_id', v_order));

    v_stream := public.metric_revenue_stream(v_lead.organization_id, p_lead_id, v_sold_at);
    -- Publique UMA receita, também quando carteira_emits_revenue_enabled está desligado.
    -- O trigger do pedido abaixo encontra esta mesma chave e não duplica o lançamento.
    INSERT INTO public.sale_events(organization_id, lead_id, deal_id, event_type, sold_at,
      sale_value, currency, revenue_stream, sale_responsible_id, pre_sale_responsible_id,
      actor, source, producer, origin_record_id)
    VALUES(v_lead.organization_id, p_lead_id, v_deal, 'sale', v_sold_at, v_value, 'BRL', v_stream,
      v_lead.sale_responsible_id, v_lead.pre_sale_responsible_id, auth.uid(), 'backfill', 'carteira', v_order);
    INSERT INTO public.upsell_orders(id, organization_id, client_id, product_name, product_type,
      sale_value, origin, sold_at, source, approval_status, approved_at, approved_by,
      sale_responsible_id, pre_sale_responsible_id, closer_id, notes)
    VALUES(v_order, v_lead.organization_id, v_client, 'Venda histórica', 'unitario', v_value,
      CASE WHEN v_stream = 'novo_negocio' THEN 'new_business' ELSE 'upsell' END,
      v_sold_at, 'historical', 'approved', now(), auth.uid(), v_lead.sale_responsible_id,
      v_lead.pre_sale_responsible_id, v_lead.sale_responsible_id, 'Registrada pelo histórico de vendas do lead.');
    v_ids := array_append(v_ids, v_deal);
  END LOOP;
  UPDATE public.upsell_clients SET first_sale_at = LEAST(first_sale_at,
    (SELECT min(sold_at) FROM public.upsell_orders WHERE client_id = v_client AND approval_status = 'approved'))
    WHERE id = v_client AND organization_id = v_lead.organization_id;
  -- O trigger de pedido novo classifica como compra de hoje. No histórico,
  -- a faixa deve refletir a última compra real, que pode ter ocorrido há meses.
  UPDATE public.upsell_clients c SET tipo_cliente_tempo = st.stage_key
    FROM LATERAL (SELECT s.stage_key FROM public.pipeline_stages s
      WHERE s.organization_id = v_lead.organization_id AND s.pipeline_type = 'upsell_base'
        AND s.is_active AND s.auto_move_min_days IS NOT NULL AND s.auto_move_max_days IS NOT NULL
        AND (SELECT days_since_last_order FROM public.upsell_clients WHERE id = v_client)
          BETWEEN s.auto_move_min_days AND s.auto_move_max_days
      ORDER BY s.position LIMIT 1) st
    WHERE c.id = v_client AND c.organization_id = v_lead.organization_id;
  UPDATE public.historical_sale_batches SET deal_ids = v_ids WHERE id = p_request_id;
  RETURN v_ids;
END;
$$;
REVOKE ALL ON FUNCTION public.registrar_vendas_historicas(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_vendas_historicas(uuid, uuid, jsonb) TO authenticated;
