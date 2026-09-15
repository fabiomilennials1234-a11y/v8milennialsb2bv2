-- The metrics page listens to committed sales, reversals and adjustments.
-- Existing SELECT grants and tenant RLS govern Realtime delivery as well.
-- No outcome, stage mapping, sale value or sales history is changed here.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'sale_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sale_events;
  END IF;
END;
$migration$;
