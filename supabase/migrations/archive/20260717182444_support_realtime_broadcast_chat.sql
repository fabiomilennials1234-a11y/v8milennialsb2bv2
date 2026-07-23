-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260717182444  name: support_realtime_broadcast_chat
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

CREATE OR REPLACE FUNCTION public.broadcast_support_comment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM realtime.broadcast_changes(
      'ticket:' || NEW.ticket_id::text,
      'new_comment',
      TG_OP,
      TG_TABLE_NAME,
      TG_TABLE_SCHEMA,
      NEW,
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'broadcast_support_comment: realtime emit failed for ticket % (comment %): %',
      NEW.ticket_id, NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.broadcast_support_comment() IS
  'ADR-0021 — emits a Broadcast on ticket:{id} when a support comment is inserted. Realtime failure is swallowed so it never blocks the insert.';

REVOKE ALL ON FUNCTION public.broadcast_support_comment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_broadcast_support_comment ON public.support_ticket_comments;
CREATE TRIGGER trg_broadcast_support_comment
  AFTER INSERT ON public.support_ticket_comments
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_support_comment();
