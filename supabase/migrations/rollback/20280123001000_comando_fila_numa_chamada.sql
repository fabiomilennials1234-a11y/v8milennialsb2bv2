-- Rollback de 20280123001000. O front cai no caminho antigo por PGRST202.
DROP FUNCTION IF EXISTS public.get_comando_fila(uuid, uuid[], integer, integer);
NOTIFY pgrst, 'reload schema';
