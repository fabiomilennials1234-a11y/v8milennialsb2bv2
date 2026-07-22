-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260709214727  name: support_ticket_rate_limit
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

CREATE INDEX IF NOT EXISTS idx_support_tickets_author_created
  ON public.support_tickets (author_user_id, created_at DESC)
  WHERE author_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_support_ticket_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  limite   CONSTANT INTEGER := 5;
  abertos  INTEGER;
  mais_antigo TIMESTAMPTZ;
  tz       TEXT;
BEGIN
  IF NEW.author_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.is_master_user(NEW.author_user_id) THEN
    RETURN NEW;
  END IF;

  SELECT count(*), min(created_at)
    INTO abertos, mais_antigo
    FROM public.support_tickets
   WHERE author_user_id = NEW.author_user_id
     AND created_at > now() - interval '1 hour';

  IF abertos >= limite THEN
    SELECT coalesce(o.timezone, 'America/Sao_Paulo') INTO tz
      FROM public.organizations o WHERE o.id = NEW.organization_id;

    RAISE EXCEPTION 'rate_limit_chamados:%',
      to_char((mais_antigo + interval '1 hour') AT TIME ZONE tz, 'HH24:MI')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_support_ticket_rate_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_support_ticket_rate_limit ON public.support_tickets;
CREATE TRIGGER trg_support_ticket_rate_limit
  BEFORE INSERT ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.enforce_support_ticket_rate_limit();
