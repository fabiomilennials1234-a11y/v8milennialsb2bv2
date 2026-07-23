-- ROLLBACK de 20260722260000_funnel_stream_by_customer_moment.sql (#1203)
--
-- Restaura fn_capture_sale_event à definição EXATA de antes da #1203 (capturada
-- via pg_get_functiondef em prod). A etiqueta volta a ser "é cliente de
-- Carteira ativo", sem consultar flag nem metric_revenue_stream.
--
-- A fatia não escreveu dado — só redefiniu a função. Reverter é redefini-la de
-- volta. Nenhuma linha de sale_events é tocada.

CREATE OR REPLACE FUNCTION public.fn_capture_sale_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;
