-- ============================================================================
-- Drop órfão deixado pela consolidação de permissões (PRD #408).
--
-- Migration 20261032000002_permission_consolidation_drop_legacy.sql dropou
-- organization_role_permissions CASCADE, mas CASCADE não derruba funções
-- PL/pgSQL que referenciam a tabela no corpo. O trigger continuou ativo,
-- bloqueando criação de novas organizações com:
--   ERROR: relation "public.organization_role_permissions" does not exist
--
-- Defaults agora vêm de feature_permissions.default_value
-- (seedados em 20261032000000_permission_consolidation_seed.sql).
-- Seed per-org legado é redundante — não replicar.
-- ============================================================================

DROP TRIGGER IF EXISTS tg_seed_org_role_permissions ON public.organizations;
DROP FUNCTION IF EXISTS public.seed_member_org_role_permissions();
