-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260717195831  name: support_ticket_symmetric_notification
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

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

  SELECT id, organization_id, author_user_id, title
    INTO t
    FROM public.support_tickets
   WHERE id = NEW.ticket_id;

  IF public.is_master_user(NEW.author_user_id) THEN
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
  ELSE
    INSERT INTO public.notifications (organization_id, user_id, type, title, description, entity_id)
    SELECT
      t.organization_id,
      mu.user_id,
      'support_ticket_customer_reply',
      'Cliente respondeu um chamado',
      left(t.title, 120),
      t.id
    FROM public.master_users mu
    WHERE mu.is_active
      AND mu.user_id IS NOT NULL
      AND mu.user_id <> NEW.author_user_id;
  END IF;

  RETURN NEW;
END;
$$;
