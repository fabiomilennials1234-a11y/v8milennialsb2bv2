-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260710184646  name: support_notify_staff_trigger
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

CREATE OR REPLACE FUNCTION public.notify_support_staff_new_ticket()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_secret text;
BEGIN
  SELECT value INTO v_url FROM public.cron_config WHERE key = 'support_notify_staff_url';
  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';

  IF v_url IS NOT NULL AND v_url != '' THEN
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', COALESCE(v_secret, '')
      ),
      body := jsonb_build_object('ticket_id', NEW.id)
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_support_staff_new_ticket IS
  'Trigger: notifica support-notify-staff via pg_net após INSERT em support_tickets. Fire-and-forget, best-effort (#1030).';

DROP TRIGGER IF EXISTS trg_support_ticket_notify_staff ON public.support_tickets;
CREATE TRIGGER trg_support_ticket_notify_staff
  AFTER INSERT ON public.support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_support_staff_new_ticket();

INSERT INTO public.cron_config (key, value)
VALUES ('support_notify_staff_url', 'https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/support-notify-staff')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
