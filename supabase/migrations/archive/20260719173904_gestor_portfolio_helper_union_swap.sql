-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260719173904  name: gestor_portfolio_helper_union_swap
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- S1 #1137 — Gestor de Portfólio: SWAP (união nos helpers + clip roster). ADR-0021.
-- Review de segurança concluído contra policies reais de prod (2026-07-19):
-- união só destrava writes operacionais; nada estrutural; clip = team_members.

CREATE OR REPLACE FUNCTION public.get_my_team_admin_organization_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT organization_id
  FROM public.team_members
  WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.get_my_organization_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT organization_id
  FROM public.team_members
  WHERE user_id = auth.uid() AND is_active = true
  UNION
  SELECT * FROM public.get_my_gestor_organization_ids();
$$;

CREATE OR REPLACE FUNCTION public.get_my_admin_organization_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT organization_id
  FROM public.team_members
  WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
  UNION
  SELECT * FROM public.get_my_gestor_organization_ids();
$$;

-- CLIP carve-out roster: writes de team_members exigem admin REAL (sem gestor).
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
