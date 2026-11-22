-- Rollback de 20280123000000. O front cai em N× get_pipeline_page por PGRST202.
DROP FUNCTION IF EXISTS public.get_pipeline_board(uuid, uuid, text[], integer, text, uuid, uuid[], text[], integer, integer, integer, integer, text, text, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, text[], timestamp with time zone, text[], text[], boolean, text[], text[], integer, integer);
NOTIFY pgrst, 'reload schema';
