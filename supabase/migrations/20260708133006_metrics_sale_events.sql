-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260708133006  name: metrics_sale_events
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- 20270302000030 (#993, ADR-0017 §2-4)
CREATE TABLE public.sale_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  pipeline_id uuid NOT NULL,
  stage_key text NOT NULL,
  stage_event_id uuid,
  event_type text NOT NULL CONSTRAINT sale_events_event_type_check CHECK (event_type IN ('sale','sale_reversed','sale_lost')),
  reversed_event_id uuid REFERENCES public.sale_events(id) ON DELETE CASCADE,
  sold_at timestamptz NOT NULL DEFAULT now(),
  sale_value numeric,
  currency text NOT NULL DEFAULT 'BRL' CONSTRAINT sale_events_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  revenue_stream text NOT NULL CONSTRAINT sale_events_revenue_stream_check CHECK (revenue_stream IN ('novo_negocio','carteira')),
  sale_responsible_id uuid,
  pre_sale_responsible_id uuid,
  actor uuid,
  source text NOT NULL DEFAULT 'trigger' CONSTRAINT sale_events_source_check CHECK (source IN ('trigger','backfill')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sale_events_reversal_coherence CHECK ((event_type = 'sale_reversed') = (reversed_event_id IS NOT NULL)),
  CONSTRAINT sale_events_value_non_negative CHECK (sale_value IS NULL OR sale_value >= 0)
);
COMMENT ON TABLE public.sale_events IS 'ADR-0017 §2-4 / #993 — caderno append-only de vendas. Fonte ÚNICA de receita (SP-3), líquida de estornos.';

CREATE INDEX idx_sale_events_org_sold ON public.sale_events (organization_id, sold_at);
CREATE INDEX idx_sale_events_org_stream_sold ON public.sale_events (organization_id, revenue_stream, sold_at);
CREATE INDEX idx_sale_events_lead ON public.sale_events (lead_id, sold_at DESC);
CREATE INDEX idx_sale_events_open_sale ON public.sale_events (lead_id, pipeline_id, sold_at DESC) WHERE event_type = 'sale';
CREATE INDEX idx_sale_events_reversed ON public.sale_events (reversed_event_id) WHERE reversed_event_id IS NOT NULL;

ALTER TABLE public.sale_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY sale_events_select ON public.sale_events FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

REVOKE ALL ON public.sale_events FROM PUBLIC;
REVOKE ALL ON public.sale_events FROM anon;
REVOKE ALL ON public.sale_events FROM authenticated;
REVOKE ALL ON public.sale_events FROM service_role;
GRANT SELECT ON public.sale_events TO authenticated;
GRANT SELECT ON public.sale_events TO service_role;

CREATE FUNCTION public.fn_sale_events_block_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'sale_events é append-only (ADR-0017): UPDATE proibido — corrija com evento novo (estorno + venda nova)' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.leads WHERE id = OLD.lead_id)
     AND EXISTS (SELECT 1 FROM public.organizations WHERE id = OLD.organization_id) THEN
    RAISE EXCEPTION 'sale_events é append-only (ADR-0017): DELETE proibido — eventos só caem em cascade de lead/org' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_sale_events_block_mutation() FROM PUBLIC;
CREATE TRIGGER trg_sale_events_immutable BEFORE UPDATE OR DELETE ON public.sale_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_sale_events_block_mutation();

CREATE FUNCTION public.fn_sale_events_force_sold_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source = 'trigger' THEN NEW.sold_at := now(); END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_sale_events_force_sold_at BEFORE INSERT ON public.sale_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_sale_events_force_sold_at();

CREATE FUNCTION public.metric_stage_role(p_organization_id uuid, p_pipeline_id uuid, p_stage_key text)
RETURNS public.stage_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT ps.stage_role
  FROM public.pipelines p
  JOIN public.pipeline_stages ps ON ps.organization_id = p.organization_id AND ps.pipeline_type = p.slug AND ps.stage_key = p_stage_key
  WHERE p.id = p_pipeline_id AND p.organization_id = p_organization_id AND p_stage_key IS NOT NULL
$$;
REVOKE EXECUTE ON FUNCTION public.metric_stage_role(uuid, uuid, text) FROM PUBLIC;
COMMENT ON FUNCTION public.metric_stage_role(uuid, uuid, text) IS 'ADR-0017 §1 / #993 — resolve o stage_role governado de (org, pipeline, stage_key). NULL = sem governança ≙ open. Ponto único de extensão.';

CREATE FUNCTION public.fn_capture_sale_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_from_role public.stage_role; v_to_role public.stage_role;
  v_meta jsonb; v_sale_value numeric; v_currency text;
  v_sale_resp uuid; v_pre_resp uuid; v_stream text; v_original public.sale_events%ROWTYPE;
BEGIN
  v_from_role := public.metric_stage_role(NEW.organization_id, NEW.pipeline_id, NEW.from_stage_key);
  v_to_role := public.metric_stage_role(NEW.organization_id, NEW.pipeline_id, NEW.to_stage_key);
  IF v_from_role IS DISTINCT FROM 'won' AND v_to_role IS DISTINCT FROM 'won' AND v_to_role IS DISTINCT FROM 'lost' THEN
    RETURN NEW;
  END IF;
  IF v_from_role = 'won' AND v_to_role IS DISTINCT FROM 'won' THEN
    SELECT s.* INTO v_original FROM public.sale_events s
    WHERE s.lead_id = NEW.lead_id AND s.pipeline_id = NEW.pipeline_id AND s.event_type = 'sale'
      AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = s.id)
    ORDER BY s.sold_at DESC, s.created_at DESC LIMIT 1;
    IF FOUND THEN
      INSERT INTO public.sale_events
        (organization_id, lead_id, pipeline_id, stage_key, stage_event_id, event_type, reversed_event_id, sold_at, sale_value, currency, revenue_stream, sale_responsible_id, pre_sale_responsible_id, actor, source)
      VALUES
        (NEW.organization_id, NEW.lead_id, NEW.pipeline_id, NEW.to_stage_key, NEW.id, 'sale_reversed', v_original.id, now(),
         v_original.sale_value, v_original.currency, v_original.revenue_stream, v_original.sale_responsible_id, v_original.pre_sale_responsible_id, NEW.actor, 'trigger');
    END IF;
  END IF;
  IF (v_to_role = 'won' AND v_from_role IS DISTINCT FROM 'won') OR (v_to_role = 'lost' AND v_from_role IS DISTINCT FROM 'lost') THEN
    SELECT pe.metadata INTO v_meta FROM public.pipeline_entries pe WHERE pe.id = NEW.entry_id;
    BEGIN
      v_sale_value := NULLIF(v_meta->>'sale_value', '')::numeric;
    EXCEPTION WHEN OTHERS THEN v_sale_value := NULL;
    END;
    v_currency := COALESCE(NULLIF(upper(v_meta->>'currency'), ''), 'BRL');
    IF v_currency !~ '^[A-Z]{3}$' THEN v_currency := 'BRL'; END IF;
    SELECT COALESCE(l.sale_responsible_id, l.closer_id), l.pre_sale_responsible_id
      INTO v_sale_resp, v_pre_resp
    FROM public.leads l WHERE l.id = NEW.lead_id AND l.organization_id = NEW.organization_id;
    v_stream := CASE WHEN EXISTS (
        SELECT 1 FROM public.upsell_clients uc WHERE uc.organization_id = NEW.organization_id AND uc.lead_id = NEW.lead_id AND uc.is_active
      ) THEN 'carteira' ELSE 'novo_negocio' END;
    INSERT INTO public.sale_events
      (organization_id, lead_id, pipeline_id, stage_key, stage_event_id, event_type, reversed_event_id, sold_at, sale_value, currency, revenue_stream, sale_responsible_id, pre_sale_responsible_id, actor, source)
    VALUES
      (NEW.organization_id, NEW.lead_id, NEW.pipeline_id, NEW.to_stage_key, NEW.id,
       CASE WHEN v_to_role = 'won' THEN 'sale' ELSE 'sale_lost' END,
       NULL, now(), v_sale_value, v_currency, v_stream, v_sale_resp, v_pre_resp, NEW.actor, 'trigger');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_capture_sale_event() FROM PUBLIC;
COMMENT ON FUNCTION public.fn_capture_sale_event() IS 'ADR-0017 §2-4 / #993 — deriva sale/sale_lost/sale_reversed de cada evento ao vivo do caderno de etapa.';
CREATE TRIGGER trg_pipeline_stage_events_sale_capture
  AFTER INSERT ON public.pipeline_stage_events
  FOR EACH ROW WHEN (NEW.source = 'trigger')
  EXECUTE FUNCTION public.fn_capture_sale_event();
