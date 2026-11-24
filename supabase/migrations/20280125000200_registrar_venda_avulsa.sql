-- O negócio nasce ganho. O vínculo com o funil fica no negócio e no caderno
-- de vendas, sem fabricar pessoa, pedido, passagem de etapa ou evento de lead.
BEGIN;

SET LOCAL lock_timeout = '3s';

ALTER TABLE public.sale_events
  ALTER COLUMN lead_id DROP NOT NULL,
  ADD CONSTRAINT sale_events_lead_or_direct_sale CHECK (
    lead_id IS NOT NULL OR (
      producer = 'deal' AND deal_id IS NOT NULL AND pipeline_id IS NOT NULL
    )
  ) NOT VALID;
ALTER TABLE public.sale_events VALIDATE CONSTRAINT sale_events_lead_or_direct_sale;

CREATE OR REPLACE FUNCTION public.fn_sale_events_force_sold_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_original public.sale_events%ROWTYPE;
BEGIN
  IF NEW.adjusts_sale_id IS NOT NULL THEN
    SELECT * INTO v_original FROM public.sale_events WHERE id = NEW.adjusts_sale_id;
    IF NOT FOUND OR v_original.event_type NOT IN ('sale', 'sale_lost')
       OR NEW.event_type NOT IN (v_original.event_type, 'sale_reversed')
       OR v_original.organization_id IS DISTINCT FROM NEW.organization_id
       OR (v_original.deal_id IS DISTINCT FROM NEW.deal_id
           AND NOT (v_original.event_type = 'sale_lost' AND v_original.deal_id IS NULL))
       OR v_original.lead_id IS DISTINCT FROM NEW.lead_id
       OR (NEW.event_type = 'sale_reversed' AND NEW.reversed_event_id IS DISTINCT FROM v_original.id) THEN
      RAISE EXCEPTION 'invalid_sale_adjustment' USING ERRCODE = '22023';
    END IF;
    IF NEW.event_type <> v_original.event_type OR
       COALESCE(current_setting('torque.sale_correction_event', true), '') <> NEW.id::text THEN
      NEW.sold_at := v_original.sold_at;
    END IF;
  ELSIF NEW.source <> 'backfill' AND NEW.producer <> 'carteira'
        AND NOT (NEW.producer = 'deal' AND NEW.lead_id IS NULL) THEN
    NEW.sold_at := now();
  END IF;
  RETURN NEW;
END;
$$;

-- Mantém a visibilidade do funil e a regra "meus negócios" também nas leituras
-- diretas das duas tabelas. Os registros anteriores seguem suas políticas.
CREATE POLICY venda_avulsa_deals_select ON public.deals
  AS RESTRICTIVE FOR SELECT TO authenticated USING (
    metadata->>'venda_avulsa' IS DISTINCT FROM 'true' OR (
      EXISTS (SELECT 1 FROM public.pipelines p WHERE p.id::text = deals.metadata->>'pipeline_id'
        AND p.organization_id = deals.organization_id)
      AND (
        public.has_feature_permission('pipeline.view_all', organization_id)
        OR owner_id = ANY ((SELECT public.rls_my_team_member_ids(true))::uuid[])
      )
    )
  );

CREATE POLICY venda_avulsa_deals_insert ON public.deals
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (metadata->>'venda_avulsa' IS DISTINCT FROM 'true');

CREATE POLICY venda_avulsa_deals_update ON public.deals
  AS RESTRICTIVE FOR UPDATE TO authenticated
  WITH CHECK (metadata->>'venda_avulsa' IS DISTINCT FROM 'true');

CREATE POLICY venda_avulsa_events_select ON public.sale_events
  AS RESTRICTIVE FOR SELECT TO authenticated USING (
    lead_id IS NOT NULL OR (
      EXISTS (SELECT 1 FROM public.pipelines p WHERE p.id = sale_events.pipeline_id
        AND p.organization_id = sale_events.organization_id)
      AND (
        public.has_feature_permission('pipeline.view_all', organization_id)
        OR sale_responsible_id = ANY ((SELECT public.rls_my_team_member_ids(true))::uuid[])
      )
    )
  );

CREATE INDEX deals_venda_avulsa_funil_idx
  ON public.deals (organization_id, (metadata->>'pipeline_id'), closed_at DESC, id DESC)
  WHERE deleted_at IS NULL AND metadata->>'venda_avulsa' = 'true';

CREATE FUNCTION private.gravar_venda_avulsa(
  p_organization_id uuid, p_pipeline_id uuid, p_request_id uuid, p_title text,
  p_value numeric, p_date date, p_owner_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_title text := btrim(p_title);
  v_timezone text;
  v_sold_at timestamptz;
  v_metadata jsonb := jsonb_build_object('venda_avulsa', true, 'pipeline_id', p_pipeline_id);
  v_deal public.deals%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.pipelines p WHERE p.id = p_pipeline_id
    AND p.organization_id = p_organization_id AND p.is_active) THEN
    RAISE EXCEPTION 'Funil indisponível.' USING ERRCODE = '42501';
  END IF;

  IF v_actor IS NOT NULL THEN
    PERFORM public.assert_org_access(p_organization_id);
    IF NOT COALESCE(public.has_feature_permission('pipeline.move_cards', p_organization_id), false)
       OR NOT (COALESCE(public.is_master_user(), false) OR EXISTS (
        SELECT 1 FROM public.team_members m WHERE m.organization_id = p_organization_id
          AND m.user_id = v_actor AND m.is_active AND m.role IN ('admin', 'member', 'sdr', 'bdr', 'closer')
      )) THEN
      RAISE EXCEPTION 'Sem permissão para registrar vendas neste funil.' USING ERRCODE = '42501';
    END IF;
    IF NOT COALESCE(public.has_feature_permission('pipeline.view_all', p_organization_id), false)
       AND NOT COALESCE(p_owner_id = ANY (public.rls_my_team_member_ids(true)), false) THEN
      RAISE EXCEPTION 'Selecione seu próprio usuário como vendedor.' USING ERRCODE = '42501';
    END IF;
  ELSIF current_setting('role', true) IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Autenticação necessária.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(NULLIF(o.timezone, ''), 'America/Sao_Paulo') INTO v_timezone
    FROM public.organizations o WHERE o.id = p_organization_id;
  IF p_request_id IS NULL OR v_title IS NULL OR length(v_title) NOT BETWEEN 1 AND 160
     OR p_value IS NULL OR p_value <= 0 OR p_value > 9999999999.99
     OR round(p_value, 2) <> p_value OR p_date IS NULL OR NOT isfinite(p_date)
     OR p_date > (now() AT TIME ZONE v_timezone)::date THEN
    RAISE EXCEPTION 'Informe título, valor positivo e data de venda até hoje.' USING ERRCODE = '22023';
  END IF;
  IF p_owner_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.team_members m
    WHERE m.id = p_owner_id AND m.organization_id = p_organization_id AND m.is_active) THEN
    RAISE EXCEPTION 'Vendedor indisponível nesta organização.' USING ERRCODE = '22023';
  END IF;
  v_sold_at := (p_date + time '12:00') AT TIME ZONE v_timezone;

  INSERT INTO public.deals (id, organization_id, title, value, currency, owner_id,
    source, created_by, won, outcome, closed_at, outcome_at, outcome_source, metadata)
  VALUES (p_request_id, p_organization_id, v_title, p_value, 'BRL', p_owner_id,
    CASE WHEN v_actor IS NULL THEN 'import' ELSE 'human' END, v_actor, true, 'won',
    v_sold_at, v_sold_at, CASE WHEN v_actor IS NULL THEN 'backfill' ELSE 'ui' END, v_metadata)
  ON CONFLICT (id) DO NOTHING;

  IF NOT FOUND THEN
    SELECT * INTO v_deal FROM public.deals WHERE id = p_request_id;
    IF v_deal.organization_id IS DISTINCT FROM p_organization_id
      OR v_deal.created_by IS DISTINCT FROM v_actor OR v_deal.metadata IS DISTINCT FROM v_metadata
      OR v_deal.owner_id IS DISTINCT FROM p_owner_id OR v_deal.outcome_at IS DISTINCT FROM v_sold_at
      OR v_deal.title IS DISTINCT FROM v_title OR v_deal.value IS DISTINCT FROM p_value
      OR v_deal.deleted_at IS NOT NULL OR v_deal.outcome IS DISTINCT FROM 'won'
      OR NOT EXISTS (SELECT 1 FROM public.sale_events e WHERE e.deal_id = p_request_id
        AND e.organization_id = p_organization_id AND e.pipeline_id = p_pipeline_id
        AND e.lead_id IS NULL AND e.event_type = 'sale') THEN
      RAISE EXCEPTION 'Este registro já está em uso.' USING ERRCODE = '22023';
    END IF;
    RETURN p_request_id;
  END IF;

  INSERT INTO public.sale_events (organization_id, pipeline_id, deal_id,
    event_type, sold_at, sale_value, currency, revenue_stream, sale_responsible_id,
    actor, source, producer, origin_record_id)
  VALUES (p_organization_id, p_pipeline_id, p_request_id, 'sale', v_sold_at, p_value,
    'BRL', 'novo_negocio', p_owner_id, v_actor, CASE WHEN v_actor IS NULL THEN 'backfill' ELSE 'ui' END,
    'deal', p_request_id);

  RETURN p_request_id;
END;
$$;

REVOKE ALL ON FUNCTION private.gravar_venda_avulsa(uuid, uuid, uuid, text, numeric, date, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.gravar_venda_avulsa(uuid, uuid, uuid, text, numeric, date, uuid)
  TO authenticated;

CREATE FUNCTION public.registrar_venda_avulsa(
  p_organization_id uuid, p_pipeline_id uuid, p_request_id uuid, p_title text,
  p_value numeric, p_date date, p_owner_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  -- Leitura como chamador, sob as políticas da organização e do funil.
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.pipelines p
    WHERE p.id = p_pipeline_id AND p.organization_id = p_organization_id AND p.is_active) THEN
    RAISE EXCEPTION 'Funil indisponível.' USING ERRCODE = '42501';
  END IF;
  RETURN private.gravar_venda_avulsa(p_organization_id, p_pipeline_id, p_request_id,
    p_title, p_value, p_date, p_owner_id);
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_venda_avulsa(uuid, uuid, uuid, text, numeric, date, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_venda_avulsa(uuid, uuid, uuid, text, numeric, date, uuid)
  TO authenticated;

-- Os caminhos de edição legados não reconciliam um negócio sem lead com o
-- caderno. Impeça alterações que deixariam valor, autoria ou desfecho divergentes.
CREATE FUNCTION private.proteger_venda_avulsa() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF (NEW.organization_id, NEW.source_lead_id, NEW.title, NEW.value, NEW.currency,
      NEW.owner_id, NEW.closed_at, NEW.outcome_at, NEW.outcome, NEW.won, NEW.deleted_at, NEW.metadata)
     IS DISTINCT FROM
     (OLD.organization_id, OLD.source_lead_id, OLD.title, OLD.value, OLD.currency,
      OLD.owner_id, OLD.closed_at, OLD.outcome_at, OLD.outcome, OLD.won, OLD.deleted_at, OLD.metadata) THEN
    RAISE EXCEPTION 'Este negócio foi registrado como venda avulsa.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.proteger_venda_avulsa() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER proteger_venda_avulsa
  BEFORE UPDATE ON public.deals FOR EACH ROW
  WHEN (OLD.metadata->>'venda_avulsa' = 'true')
  EXECUTE FUNCTION private.proteger_venda_avulsa();

COMMIT;
