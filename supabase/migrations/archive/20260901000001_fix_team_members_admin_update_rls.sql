-- =================================================================
-- FIX DEFINITIVO: Admin não consegue editar team_members (metric_type, etc.)
--
-- Problema:
--   Admins da organização não conseguem alterar metric_type nem outros
--   campos de team_members. O frontend exibe botão "Editar" (useIsAdmin
--   tem fallback em team_members.role), mas o RLS bloqueia o UPDATE.
--
-- Causa raiz:
--   A policy "Apenas admins podem gerenciar team members" (FOR ALL)
--   usa has_role(auth.uid(), 'admin'), que originalmente só checava
--   user_roles. A migration 20260331000000 corrigiu has_role() para
--   checar ambas as tabelas, mas pode não ter sido aplicada ao banco.
--
--   Além disso, a policy original não tem isolamento por organização,
--   o que é uma brecha de segurança multi-tenant.
--
-- Solução:
--   1. Re-aplicar has_role() e is_user_admin() corrigidos (idempotente)
--   2. Substituir a policy FOR ALL genérica por policies específicas
--      com isolamento por organização
--   3. Sync user_roles para admins que possam estar faltando
--   4. Manter compatibilidade com master
--
-- Impacto:
--   - Admins conseguem editar/criar/excluir membros da PRÓPRIA org
--   - Segurança multi-tenant garantida
--   - Master continua com acesso total (policy separada existente)
--   - Não afeta ranking, metas, comissões, performance
-- =================================================================

-- ============================================
-- 1. GARANTIR has_role() CORRETO (idempotente)
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

-- ============================================
-- 2. GARANTIR is_user_admin() CORRETO (idempotente)
-- ============================================
CREATE OR REPLACE FUNCTION public.is_user_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
  OR EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
  )
$$;

-- ============================================
-- 3. SUBSTITUIR policy genérica por policies com isolamento por org
-- ============================================

-- Remover a policy antiga sem isolamento de organização
DROP POLICY IF EXISTS "Apenas admins podem gerenciar team members" ON public.team_members;

-- UPDATE: admin da mesma organização pode editar membros
CREATE POLICY "team_members_update_admin_org"
  ON public.team_members FOR UPDATE
  TO authenticated
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      WHERE tm.user_id = auth.uid() AND tm.role = 'admin' AND tm.is_active = true
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      WHERE tm.user_id = auth.uid() AND tm.role = 'admin' AND tm.is_active = true
    )
  );

-- INSERT: admin da mesma organização pode criar membros
CREATE POLICY "team_members_insert_admin_org"
  ON public.team_members FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      WHERE tm.user_id = auth.uid() AND tm.role = 'admin' AND tm.is_active = true
    )
  );

-- DELETE: admin da mesma organização pode remover membros
CREATE POLICY "team_members_delete_admin_org"
  ON public.team_members FOR DELETE
  TO authenticated
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      WHERE tm.user_id = auth.uid() AND tm.role = 'admin' AND tm.is_active = true
    )
  );

-- ============================================
-- 4. SYNC: garantir que admins tenham entrada em user_roles
-- ============================================
-- Admins com team_members.role = 'admin' mas sem user_roles ficam
-- invisíveis para a versão antiga de has_role(). Este sync resolve.
INSERT INTO public.user_roles (user_id, role)
SELECT DISTINCT tm.user_id, tm.role
FROM public.team_members tm
JOIN auth.users au ON au.id = tm.user_id
WHERE tm.user_id IS NOT NULL
  AND tm.is_active = true
  AND tm.role = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = tm.user_id AND ur.role = 'admin'
  )
ON CONFLICT (user_id, role) DO NOTHING;
