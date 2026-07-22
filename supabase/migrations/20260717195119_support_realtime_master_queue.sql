-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260717195119  name: support_realtime_master_queue
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- Support realtime — S2: live master queue via postgres_changes (ADR-0021).
-- support_tickets joins the publication. apply_rls evaluates support_tickets_select
-- per subscriber: a master (is_master_user()) receives every org's ticket events —
-- the cross-org queue with no client-side org filter — while a non-master sees only
-- their own / their org's. UPDATE events (claim/triage/status) ride the same channel.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.support_tickets;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
