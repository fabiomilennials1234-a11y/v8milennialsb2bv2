-- ============================================================
-- FIX: Conceder permissão EXECUTE para a RPC get_dashboard_metrics
-- Sem este GRANT, PostgREST retorna 400 ao chamar a função.
-- ============================================================

-- Conceder ao role authenticated (usuários logados)
GRANT EXECUTE ON FUNCTION public.get_dashboard_metrics(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated;

-- Conceder ao service_role (edge functions)
GRANT EXECUTE ON FUNCTION public.get_dashboard_metrics(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO service_role;

-- Recarregar schema do PostgREST para reconhecer a função
NOTIFY pgrst, 'reload schema';
