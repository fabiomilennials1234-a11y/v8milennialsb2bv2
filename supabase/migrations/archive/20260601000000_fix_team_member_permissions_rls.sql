-- =================================================================
-- FIX: team_member_org_permissions RLS policies usavam JOIN direto
-- em user_roles, quebrando para admins sem entrada em user_roles.
--
-- Problema:
--   As policies de INSERT/UPDATE/DELETE faziam JOIN com user_roles
--   para checar admin. Mas admin pode ter role apenas em team_members.
--   has_role() já checa ambas tabelas (corrigido em 20260331), porém
--   essas policies não usavam has_role().
--
-- Também corrige: user_has_org_permission() para checar admin em
-- ambas tabelas (user_roles + team_members).
--
-- Impacto:
--   Admin que tem role em team_members mas não em user_roles agora
--   consegue salvar permissões dos membros sem erro de RLS.
-- =================================================================

-- ============================================
-- 1. RECRIAR POLICIES usando has_role()
-- ============================================

DROP POLICY IF EXISTS "team_member_org_permissions_insert_admin" ON public.team_member_org_permissions;
CREATE POLICY "team_member_org_permissions_insert_admin"
  ON public.team_member_org_permissions FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    AND EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.user_id = auth.uid() AND tm.is_active = true
      AND tm.organization_id = (
        SELECT organization_id FROM public.team_members WHERE id = team_member_id LIMIT 1
      )
    )
  );

DROP POLICY IF EXISTS "team_member_org_permissions_update_admin" ON public.team_member_org_permissions;
CREATE POLICY "team_member_org_permissions_update_admin"
  ON public.team_member_org_permissions FOR UPDATE
  USING (
    public.has_role(auth.uid(), 'admin')
    AND EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.user_id = auth.uid() AND tm.is_active = true
      AND tm.organization_id = (
        SELECT organization_id FROM public.team_members WHERE id = team_member_id LIMIT 1
      )
    )
  );

DROP POLICY IF EXISTS "team_member_org_permissions_delete_admin" ON public.team_member_org_permissions;
CREATE POLICY "team_member_org_permissions_delete_admin"
  ON public.team_member_org_permissions FOR DELETE
  USING (
    public.has_role(auth.uid(), 'admin')
    AND EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.user_id = auth.uid() AND tm.is_active = true
      AND tm.organization_id = (
        SELECT organization_id FROM public.team_members WHERE id = team_member_id LIMIT 1
      )
    )
  );

-- ============================================
-- 2. CORRIGIR user_has_org_permission() para checar admin
--    em user_roles OU team_members (igual has_role)
-- ============================================

CREATE OR REPLACE FUNCTION public.user_has_org_permission(p_permission_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    -- Admin (em user_roles OU team_members) sempre tem todas as permissões
    (SELECT true WHERE public.has_role(auth.uid(), 'admin')),
    -- Permissão individual do membro
    (SELECT tmo.enabled
     FROM public.team_member_org_permissions tmo
     JOIN public.team_members tm ON tm.id = tmo.team_member_id
     WHERE tm.user_id = auth.uid() AND tm.is_active = true
       AND tmo.permission_key = p_permission_key
     LIMIT 1),
    -- Fallback: permissão do role da organização
    (SELECT orp.enabled
     FROM public.organization_role_permissions orp
     JOIN public.team_members tm ON tm.organization_id = orp.organization_id AND tm.role::text = orp.role
     WHERE tm.user_id = auth.uid() AND tm.is_active = true
       AND orp.permission_key = p_permission_key
     LIMIT 1),
    false
  )
$$;

COMMENT ON FUNCTION public.user_has_org_permission IS 'Admin (user_roles ou team_members) sempre true. Senão: team_member_org_permissions > organization_role_permissions > false.';
