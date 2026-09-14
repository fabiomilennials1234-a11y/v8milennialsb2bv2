CREATE OR REPLACE FUNCTION public.fn_carteira_admite_venda()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lead           record;
  v_client_id      uuid;
  v_estava_inativo boolean := false;
  v_emite_receita  boolean;
  v_vendas_vivas   int;
BEGIN
  IF NEW.event_type = 'sale' THEN
    SELECT l.* INTO v_lead
      FROM public.leads l
     WHERE l.id = NEW.lead_id
       AND l.organization_id = NEW.organization_id
       AND l.deleted_at IS NULL;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;

    SELECT coalesce(o.carteira_emits_revenue_enabled, false)
      INTO v_emite_receita
      FROM public.organizations o
     WHERE o.id = NEW.organization_id;

    SELECT uc.id, NOT uc.is_active
      INTO v_client_id, v_estava_inativo
      FROM public.upsell_clients uc
     WHERE uc.organization_id = NEW.organization_id
       AND uc.lead_id = NEW.lead_id;

    IF v_client_id IS NULL THEN
      INSERT INTO public.upsell_clients (
        organization_id, lead_id, name, company, email, phone,
        first_sale_at, closer_id, responsible_id,
        sale_responsible_id, pre_sale_responsible_id,
        segment, gestao_stage
      ) VALUES (
        NEW.organization_id, NEW.lead_id, v_lead.name, v_lead.company, v_lead.email, v_lead.phone,
        NEW.sold_at, v_lead.closer_id, v_lead.responsible_id,
        NEW.sale_responsible_id,
        NEW.pre_sale_responsible_id,
        'novo', 'primeira_compra'
      )
      ON CONFLICT (organization_id, lead_id) DO UPDATE
        SET updated_at = now()
      RETURNING id INTO v_client_id;
    ELSE
      UPDATE public.upsell_clients
         SET is_active      = true,
             churned_at     = NULL,
             reactivated_at = CASE WHEN v_estava_inativo THEN now() ELSE reactivated_at END,
             first_sale_at  = LEAST(first_sale_at, NEW.sold_at),
             updated_at     = now()
       WHERE id = v_client_id;
    END IF;

    IF NOT v_emite_receita AND coalesce(NEW.sale_value, 0) > 0 THEN
      INSERT INTO public.upsell_orders (
        organization_id, client_id, closer_id,
        product_name, product_type, sale_value,
        origin, source, sold_at,
        approval_status, approved_at,
        responsible_id, pre_sale_responsible_id, sale_responsible_id,
        external_source, external_id
      ) VALUES (
        NEW.organization_id, v_client_id, v_lead.closer_id,
        'Venda do funil', 'projeto', NEW.sale_value,
        'new_business', 'pipe', NEW.sold_at,
        'approved', now(),
        v_lead.responsible_id,
        NEW.pre_sale_responsible_id,
        NEW.sale_responsible_id,
        'funnel_sale_event', NEW.id::text
      )
      ON CONFLICT (organization_id, external_source, external_id)
        WHERE external_source IS NOT NULL AND external_id IS NOT NULL
        DO NOTHING;
    END IF;

    PERFORM public.recalc_upsell_client_metrics(v_client_id);
    RETURN NULL;
  END IF;

  IF NEW.event_type = 'sale_reversed' THEN
    SELECT uc.id INTO v_client_id
      FROM public.upsell_clients uc
     WHERE uc.organization_id = NEW.organization_id
       AND uc.lead_id = NEW.lead_id;
    IF v_client_id IS NULL THEN
      RETURN NULL;
    END IF;

    DELETE FROM public.upsell_orders
     WHERE organization_id = NEW.organization_id
       AND external_source = 'funnel_sale_event'
       AND external_id = NEW.reversed_event_id::text;

    PERFORM public.recalc_upsell_client_metrics(v_client_id);

    SELECT count(*) INTO v_vendas_vivas
      FROM public.sale_events s
     WHERE s.organization_id = NEW.organization_id
       AND s.lead_id = NEW.lead_id
       AND s.event_type = 'sale'
       AND NOT EXISTS (
             SELECT 1 FROM public.sale_events r
              WHERE r.event_type = 'sale_reversed'
                AND r.reversed_event_id = s.id
           );

    IF v_vendas_vivas = 0
       AND NOT EXISTS (SELECT 1 FROM public.upsell_orders uo WHERE uo.client_id = v_client_id)
       AND NOT EXISTS (
             SELECT 1 FROM public.upsell_clients uc
              WHERE uc.id = v_client_id
                AND (uc.tiny_contact_id IS NOT NULL OR uc.external_id IS NOT NULL)
           )
    THEN
      UPDATE public.upsell_clients
         SET is_active  = false,
             churned_at = now(),
             updated_at = now()
       WHERE id = v_client_id;
    END IF;
  END IF;

  RETURN NULL;
END;
$function$;
