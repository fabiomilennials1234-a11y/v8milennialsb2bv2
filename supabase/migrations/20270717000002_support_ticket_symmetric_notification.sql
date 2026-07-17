-- Support realtime — S3: symmetric notification (ADR-0021, extends ADR-0018)
--
-- ADR-0018's notify_support_ticket_reply notified only the customer, when a master
-- replied. This adds the missing direction: when a customer (non-master) replies,
-- notify every active master, so a reply that lands while staff is on another screen
-- still raises a badge — the same signal the customer already has. The
-- master-replied -> notify-author path is unchanged; internal notes still notify
-- no one. The master notification uses type 'support_ticket_customer_reply' so the
-- master badge query can isolate it from the customer's 'support_ticket_reply'.

CREATE OR REPLACE FUNCTION public.notify_support_ticket_reply()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t RECORD;
BEGIN
  -- Nota interna: ninguém é notificado (o cliente não deve nem saber que existe).
  IF NEW.is_internal THEN
    RETURN NEW;
  END IF;

  SELECT id, organization_id, author_user_id, title
    INTO t
    FROM public.support_tickets
   WHERE id = NEW.ticket_id;

  IF public.is_master_user(NEW.author_user_id) THEN
    -- Resposta do suporte → notifica o autor do Chamado (cliente), como antes.
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
    -- Resposta do cliente → notifica todo master ativo. Simetria com o badge que o
    -- cliente já tem: o staff não perde uma resposta que chegou fora da tela.
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
