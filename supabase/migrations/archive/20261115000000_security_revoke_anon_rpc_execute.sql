-- 20261115000000_security_revoke_anon_rpc_execute.sql
--
-- SECURITY HARDENING — remover execução anônima de RPCs SECURITY DEFINER.
--
-- Auditoria 2026-06-01: um chamador ANÔNIMO (role `anon`, sem login) executava
-- via PostgREST RPC:
--   - public.validate_coupon(text, text)  -> enumeração de cupons/descontos
--   - public.get_lead_ai_status(uuid)     -> estado de IA / existência de lead por id
--
-- Ambas tinham EXECUTE concedido a `PUBLIC` (default do Postgres) E a `anon`
-- (GRANT explícito) — anon alcançava por qualquer um dos dois. Fix: revogar de
-- PUBLIC e de anon, mantendo apenas `authenticated` e `service_role`.
--
-- Consumidores legítimos (todos autenticados):
--   - validate_coupon: useCouponValidation (checkout autenticado / provisionamento
--     via service_role). As rotas públicas de checkout foram removidas
--     (App.tsx: "Old onboarding/checkout routes removed").
--   - get_lead_ai_status: useLeads, useCopilotToggle (app autenticado);
--     agent-message / webhooks usam service_role.
--
-- Idempotente. Seguro re-aplicar via Management API e via `supabase db push`.

BEGIN;

-- validate_coupon(text, text)
REVOKE EXECUTE ON FUNCTION public.validate_coupon(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validate_coupon(text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.validate_coupon(text, text) TO authenticated, service_role;

-- get_lead_ai_status(uuid)
REVOKE EXECUTE ON FUNCTION public.get_lead_ai_status(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_lead_ai_status(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_lead_ai_status(uuid) TO authenticated, service_role;

COMMIT;
