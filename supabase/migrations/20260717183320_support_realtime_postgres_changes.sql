-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260717183320  name: support_realtime_postgres_changes
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- Support realtime — S1 pivot: postgres_changes replaces Broadcast (ADR-0021 amended).
-- RLS on realtime.messages (required to authorize private Broadcast) cannot be
-- created on this project: realtime.messages is owned by supabase_realtime_admin
-- and postgres is not a member (fails via MCP and in the dashboard). postgres_changes
-- reuses the existing support_ticket_comments RLS for per-subscriber authorization
-- (author / admin-org / master, is_internal filtered) — no realtime.messages policy.

-- Remove the now-dead Broadcast emitter (emitted to private channels nobody can read).
DROP TRIGGER IF EXISTS trg_broadcast_support_comment ON public.support_ticket_comments;
DROP FUNCTION IF EXISTS public.broadcast_support_comment();

-- Publish comment inserts to Realtime; delivery is filtered per subscriber by the
-- existing support_ticket_comments_select policy (via apply_rls / can_read_support_ticket).
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.support_ticket_comments;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
