-- =================================================================
-- FIX: has_role() só checava user_roles, não team_members.role
--
-- Problema:
--   has_role(uid, 'admin') retorna FALSE para admins que têm
--   admin apenas em team_members.role (sem entrada em user_roles).
--   O frontend (useIsAdmin) tem fallback para team_members.role,
--   então o admin vê o botão "Editar" mas o RLS bloqueia o UPDATE.
--
-- Impacto:
--   Todas as policies que usam has_role() — team_members, tags,
--   goals, awards, commissions, user_roles, campanhas, etc.
--
-- Solução:
--   Atualizar has_role() para checar AMBAS as tabelas, igual ao
--   is_user_admin() (corrigido em 20260322). Mesma lógica, mas
--   genérica para qualquer role.
-- =================================================================

-- ============================================
-- 1. CORRIGIR has_role() — checar user_roles + team_members
-- ============================================
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
  OR EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = _user_id AND role = _role AND is_active = true
  )
$$;

COMMENT ON FUNCTION public.has_role IS 'Verifica role do usuário em user_roles OU team_members (ativo). Corrigido em 20260331 para checar ambas tabelas.';
