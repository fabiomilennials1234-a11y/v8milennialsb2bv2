-- Migration: Trigger em leads para enfileirar webhooks outbound (eventos do client)
-- Description: AFTER INSERT/UPDATE em leads insere em webhook_deliveries para webhooks da org.
-- Date: 2026-02-11

CREATE OR REPLACE FUNCTION public.enqueue_lead_webhooks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ev TEXT;
  payload JSONB;
  w RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    ev := 'lead.created';
  ELSIF TG_OP = 'UPDATE' THEN
    ev := 'lead.updated';
  ELSE
    RETURN NEW;
  END IF;

  payload := jsonb_build_object(
    'event', ev,
    'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'data', jsonb_build_object(
      'id', NEW.id,
      'name', NEW.name,
      'email', NEW.email,
      'phone', NEW.phone,
      'company', NEW.company,
      'organization_id', NEW.organization_id,
      'origin', NEW.origin
    )
  );

  FOR w IN
    SELECT id FROM public.webhooks
    WHERE organization_id = NEW.organization_id
      AND is_active = true
      AND events @> ARRAY[ev]::text[]
  LOOP
    INSERT INTO public.webhook_deliveries (webhook_id, event, payload, next_retry_at)
    VALUES (w.id, ev, payload, now());
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_lead_webhooks ON public.leads;
CREATE TRIGGER trg_enqueue_lead_webhooks
  AFTER INSERT OR UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_lead_webhooks();
