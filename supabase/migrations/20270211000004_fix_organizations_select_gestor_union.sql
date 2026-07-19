-- 20270211000004_fix_organizations_select_gestor_union.sql
-- APLICADA EM PROD via MCP em 2026-07-19 (autorizado CTO).
--
-- Fix (ADR-0021): a policy SELECT de organizations ("Users can see their
-- organization") filtrava a org via subquery INLINE em team_members. Dois
-- problemas: (1) não concedia as orgs vinculadas ao Gestor de Portfólio — a
-- união vive em get_my_organization_ids(), que esta policy não usava, então o
-- gestor lia os vínculos (gestor_organizations) mas 0 linhas de organizations,
-- e o join organizations!inner do org-switcher esvaziava ("Nenhuma organização
-- vinculada"); (2) violava a regra anti-recursão Realtime (CLAUDE.md: nunca
-- SELECT ... FROM team_members inline em policy — apply_rls recursiona).
--
-- Trocar pelo helper SECURITY DEFINER get_my_organization_ids() resolve os dois.
-- Equivalência para user normal preservada (helper = orgs de team_member ativas;
-- o inline não filtrava is_active — o helper filtra, comportamento mais correto).
-- Master continua via policies próprias (master_all_organizations, etc.).
DROP POLICY IF EXISTS "Users can see their organization" ON public.organizations;
CREATE POLICY "Users can see their organization" ON public.organizations FOR SELECT
  USING (id IN (SELECT public.get_my_organization_ids()));
