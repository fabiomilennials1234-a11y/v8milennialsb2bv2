-- 20270211000001_gestor_portfolio_helper_union_swap.sql
-- S1 #1137 — Gestor de Portfólio: SWAP HITL-GATED (ADR-0021).
--
-- ⛔ NÃO APLICADO. Este é o passo de risco cross-tenant: redefine os DOIS helpers
--    quentes usados por quase toda policy RLS de ~30 orgs. Aplicar SOMENTE após
--    review de segurança humano (gate HITL do S1) e autorização CTO explícita.
--
-- Validação feita em 2026-07-19 contra o schema REAL de prod via MCP:
--   • Aritmética da união provada (before=[membro], after=[membro ∪ gestor];
--     user sem binding → união idêntica → tenants existentes intactos).
--   • Carve-out billing: org_subscriptions/plan_addons/subscription_plans/
--     feature_permissions são master-only → união não concede nada (grátis).
--   • Carve-out roster: os 3 writes de team_members usam get_my_admin_organization_ids
--     → clipados abaixo pra get_my_team_admin_organization_ids (sem gestor).
--   • member_feature_permissions é gated por is_user_admin() (checa team_members)
--     → gestor sem team_member já é bloqueado naturalmente, sem clip.

-- 1. Preserva a lógica admin-só-de-team_members num helper dedicado (SEM gestor).
--    É o gate que o roster do cliente continua usando.
CREATE OR REPLACE FUNCTION public.get_my_team_admin_organization_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT organization_id
  FROM public.team_members
  WHERE user_id = auth.uid()
    AND role = 'admin'
    AND is_active = true;
$$;

-- 2. Helper de READ = membros ∪ orgs do gestor. Propaga leitura a toda policy SELECT.
CREATE OR REPLACE FUNCTION public.get_my_organization_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT organization_id
  FROM public.team_members
  WHERE user_id = auth.uid()
    AND is_active = true
  UNION
  SELECT * FROM public.get_my_gestor_organization_ids();
$$;

-- 3. Helper de ADMIN-WRITE = admin-de-team_member ∪ orgs do gestor.
--    Propaga escrita operacional (leads, pipes, config, campanhas) a toda policy de write.
CREATE OR REPLACE FUNCTION public.get_my_admin_organization_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT organization_id
  FROM public.team_members
  WHERE user_id = auth.uid()
    AND role = 'admin'
    AND is_active = true
  UNION
  SELECT * FROM public.get_my_gestor_organization_ids();
$$;

-- 4. CLIP do carve-out roster: os writes de team_members voltam a exigir admin REAL
--    (team_member role=admin), NUNCA gestor. Repontam pro helper sem-gestor.
DROP POLICY IF EXISTS team_members_insert_admin_org ON public.team_members;
CREATE POLICY team_members_insert_admin_org ON public.team_members FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.get_my_team_admin_organization_ids()));

DROP POLICY IF EXISTS team_members_update_admin_org ON public.team_members;
CREATE POLICY team_members_update_admin_org ON public.team_members FOR UPDATE
  USING (organization_id IN (SELECT public.get_my_team_admin_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.get_my_team_admin_organization_ids()));

DROP POLICY IF EXISTS team_members_delete_admin_org ON public.team_members;
CREATE POLICY team_members_delete_admin_org ON public.team_members FOR DELETE
  USING (organization_id IN (SELECT public.get_my_team_admin_organization_ids()));
