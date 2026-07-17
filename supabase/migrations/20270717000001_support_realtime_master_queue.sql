-- Support realtime — S2: live master queue via postgres_changes (ADR-0021)
--
-- support_tickets joins the supabase_realtime publication. apply_rls evaluates the
-- existing support_tickets_select policy per subscriber: a master (is_master_user())
-- receives every org's ticket events — the cross-org queue with NO client-side org
-- filter, which is exactly why the house useRealtimeSubscription (forces an org
-- filter) could not serve it — while a non-master receives only their own / their
-- org's. INSERT enters a new Chamado; UPDATE (claim / triage / status) reflects live.
--
-- Default REPLICA IDENTITY carries the full new row on both INSERT and UPDATE, which
-- is all the queue consumes (it invalidates and refetches to keep server ordering
-- and filters honest).

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.support_tickets;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
