-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260719220138  name: fix_organizations_select_gestor_union
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- Fix: a policy SELECT de organizations usava subquery inline em team_members,
-- então (1) não concedia as orgs vinculadas ao Gestor de Portfólio (união vive
-- em get_my_organization_ids) e (2) violava a regra anti-recursão Realtime.
-- Trocar pelo helper unifica os dois. Equivalência p/ user normal preservada;
-- master via policies próprias.
DROP POLICY IF EXISTS "Users can see their organization" ON public.organizations;
CREATE POLICY "Users can see their organization" ON public.organizations FOR SELECT
  USING (id IN (SELECT public.get_my_organization_ids()));
