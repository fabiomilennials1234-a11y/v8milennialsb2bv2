-- ============================================================
-- FIX: Conceder permissão EXECUTE para a RPC get_ranking_data
-- A função foi recriada com nova assinatura (INT, INT, UUID)
-- mas o GRANT só existia para a assinatura antiga (INT, INT).
-- ============================================================

GRANT EXECUTE ON FUNCTION public.get_ranking_data(INT, INT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ranking_data(INT, INT, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
