-- ============================================================
-- Chamado: avisar o suporte no grupo de WhatsApp quando um chamado abre (#1030).
--
-- O trigger é AFTER INSERT em `support_tickets` e apenas dispara o pg_net —
-- fire-and-forget. O Chamado já está gravado e commitado quando a notificação
-- sai; se o pg_net falhar, o `EXCEPTION WHEN OTHERS` engole e a inserção segue.
-- A notificação nunca pode derrubar a abertura do Chamado (ADR-0018): o canal
-- primário é o badge in-app, o WhatsApp é reforço.
--
-- Espelha o pattern de `notify_copilot_batch_processor`: URL e segredo vivem em
-- `cron_config`, o segredo viaja como header `x-cron-secret`, e a edge function
-- o compara contra `CRON_SECRET`. Sem URL configurada, o trigger é no-op.
-- ============================================================

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
  -- Best-effort: a notificação jamais derruba a criação do Chamado.
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

-- URL da edge function em produção. Sem esta linha o trigger é no-op — é o que
-- mantém dev quieto até a mesma chave ser inserida lá com a URL de dev.
INSERT INTO public.cron_config (key, value)
VALUES ('support_notify_staff_url', 'https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/support-notify-staff')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
