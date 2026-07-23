-- Support realtime — S1: live Chamado chat via postgres_changes (ADR-0021, amended)
--
-- The chat is delivered live by publishing support_ticket_comments to Realtime.
-- Per-subscriber authorization is the table's OWN RLS (support_ticket_comments_select:
-- author / admin-org / master, is_internal filtered) evaluated by apply_rls — no
-- new policy, and no realtime.messages policy.
--
-- Why not Broadcast (the ADR's first choice): a private Broadcast channel needs an
-- RLS policy on realtime.messages, and that table is owned by supabase_realtime_admin.
-- On this project `postgres` is not a member (CREATE POLICY fails via the Management
-- API and in the dashboard alike — only Supabase's superuser could). postgres_changes
-- reaches the same end — instant, no-refetch delivery by folding payload.new into the
-- comments cache — while reusing the authorization that already ships and is tested.
-- See ADR-0021 for the full amendment.
--
-- INSERT-only: default REPLICA IDENTITY carries the full new row. The client filters
-- by ticket_id=eq.{id} so each open thread receives only its own comments.

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.support_ticket_comments;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
