-- 20261116000000_security_revoke_anon_toggle_phone_ai.sql
--
-- SECURITY HARDENING — remover execução anônima de toggle_phone_ai.
--
-- Auditoria 2026-06-01 (verificação de integridade): o RPC SECURITY DEFINER
-- public.toggle_phone_ai(text, boolean) era executável por `anon` (sem login) e
-- NÃO tem checagem de autorização interna — faz UPDATE de leads.ai_disabled por
-- telefone. Um chamador anônimo poderia ligar/desligar a IA de QUALQUER telefone
-- em QUALQUER organização (sabotagem cross-tenant do copiloto).
--
-- EXECUTE estava em PUBLIC (default) e/ou anon. Revogamos dos dois nas duas
-- sobrecargas; mantemos authenticated + service_role (frontend autenticado e
-- webhooks/cron via service_role — os únicos consumidores legítimos).
--
-- Idempotente. Seguro re-aplicar via Management API e via `supabase db push`.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.toggle_phone_ai(text, boolean)       FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.toggle_phone_ai(text, boolean)       TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.toggle_phone_ai(text, boolean, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.toggle_phone_ai(text, boolean, uuid) TO authenticated, service_role;

COMMIT;
