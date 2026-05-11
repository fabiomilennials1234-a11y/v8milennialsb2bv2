-- Migration: Revoke EXECUTE from anon for user-write-instance RPCs
-- Description: Supabase auto-grants EXECUTE on new public functions to anon
--   via internal trigger. RPCs criadas em 20260930000000 são SECURITY DEFINER
--   e retornam dados sensíveis (vínculos user/instância, responsáveis de leads).
--   Anon nunca deve invocar essas funções → REVOKE explícito.
-- Date: 2026-09-30 (security follow-up to migration 20260930000000)

REVOKE EXECUTE ON FUNCTION public.get_user_write_instance(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_lead_write_instance(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_user_write_instance(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_instance_owner(uuid, uuid, text) FROM anon;
