-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260709210928  name: support_ticket_reply_notification
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS entity_id UUID;

COMMENT ON COLUMN public.notifications.entity_id IS
  'Ponteiro generico para a entidade do `type` (ex.: support_tickets.id quando type = support_ticket_reply). Generaliza `lead_id` sem migra-lo.';

CREATE INDEX IF NOT EXISTS idx_notifications_user_type_entity
  ON public.notifications (user_id, type, entity_id)
  WHERE read_at IS NULL;

CREATE OR REPLACE FUNCTION public.notify_support_ticket_reply()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t RECORD;
BEGIN
  IF NEW.is_internal THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_master_user(NEW.author_user_id) THEN
    RETURN NEW;
  END IF;

  SELECT id, organization_id, author_user_id, title
    INTO t
    FROM public.support_tickets
   WHERE id = NEW.ticket_id;

  IF t.author_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF t.author_user_id = NEW.author_user_id THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (organization_id, user_id, type, title, description, entity_id)
  VALUES (
    t.organization_id,
    t.author_user_id,
    'support_ticket_reply',
    'O suporte respondeu seu chamado',
    left(t.title, 120),
    t.id
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_support_ticket_reply() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_support_ticket_reply_notification ON public.support_ticket_comments;
CREATE TRIGGER trg_support_ticket_reply_notification
  AFTER INSERT ON public.support_ticket_comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_support_ticket_reply();

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
