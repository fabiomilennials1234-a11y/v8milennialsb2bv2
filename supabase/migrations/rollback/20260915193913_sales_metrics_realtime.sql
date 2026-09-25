-- Apply only to undo the publication introduced by the matching migration.
ALTER PUBLICATION supabase_realtime DROP TABLE public.sale_events;
