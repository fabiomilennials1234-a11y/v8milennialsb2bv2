-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260719172707  name: gestor_portfolio_foundation_additive
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- S1 #1137 — Gestor de Portfólio: fundação ADITIVA (ADR-0021).
-- Seguro: cria 2 tabelas novas + 1 helper novo. NÃO altera get_my_organization_ids
-- nem get_my_admin_organization_ids (o swap com união é HITL-gated, migration separada).

-- 1. Ator: gestor (fora de team_members, espelha master_users)
CREATE TABLE IF NOT EXISTS public.gestores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
CREATE INDEX IF NOT EXISTS idx_gestores_user_id ON public.gestores(user_id);
ALTER TABLE public.gestores ENABLE ROW LEVEL SECURITY;

-- 2. Binding master-gerido: quais orgs cada gestor alcança
CREATE TABLE IF NOT EXISTS public.gestor_organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gestor_id uuid NOT NULL REFERENCES public.gestores(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gestor_id, organization_id)
);
CREATE INDEX IF NOT EXISTS idx_gestor_orgs_gestor ON public.gestor_organizations(gestor_id);
CREATE INDEX IF NOT EXISTS idx_gestor_orgs_org ON public.gestor_organizations(organization_id);
ALTER TABLE public.gestor_organizations ENABLE ROW LEVEL SECURITY;

-- 3. RLS: gestor lê o próprio; master lê/escreve tudo; escrita = master-only
DROP POLICY IF EXISTS gestores_select ON public.gestores;
CREATE POLICY gestores_select ON public.gestores FOR SELECT
  USING (user_id = auth.uid() OR public.is_master_user(auth.uid()));
DROP POLICY IF EXISTS gestores_write_master ON public.gestores;
CREATE POLICY gestores_write_master ON public.gestores FOR ALL
  USING (public.is_master_user(auth.uid()))
  WITH CHECK (public.is_master_user(auth.uid()));

DROP POLICY IF EXISTS gestor_orgs_select ON public.gestor_organizations;
CREATE POLICY gestor_orgs_select ON public.gestor_organizations FOR SELECT
  USING (
    gestor_id IN (SELECT id FROM public.gestores WHERE user_id = auth.uid())
    OR public.is_master_user(auth.uid())
  );
DROP POLICY IF EXISTS gestor_orgs_write_master ON public.gestor_organizations;
CREATE POLICY gestor_orgs_write_master ON public.gestor_organizations FOR ALL
  USING (public.is_master_user(auth.uid()))
  WITH CHECK (public.is_master_user(auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gestores TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gestor_organizations TO authenticated;

-- 4. Helper ADITIVO (SECURITY DEFINER, não-recursivo). Nada o chama ainda.
--    Será unido aos 2 helpers quentes na migration HITL-gated do swap.
CREATE OR REPLACE FUNCTION public.get_my_gestor_organization_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT go.organization_id
  FROM public.gestor_organizations go
  JOIN public.gestores g ON g.id = go.gestor_id
  WHERE g.user_id = auth.uid()
    AND g.is_active = true;
$$;
