-- Rollback aditivo: reverter frontend antes de remover esta RPC.
BEGIN;
DROP FUNCTION IF EXISTS public.client_portfolio_page(uuid,jsonb,integer,integer);
NOTIFY pgrst, 'reload schema';
COMMIT;
