-- Permissões "Ver" e "Exportar" com múltiplos escopos selecionáveis
-- Troca UNIQUE(team_member_id, resource_key, action_key) por
-- UNIQUE(team_member_id, resource_key, action_key, value) para permitir
-- várias linhas por (usuário, recurso, ação), ex.: view = [só meus, da equipe].
-- Data: 2026-02-08

ALTER TABLE public.team_member_permissions
  DROP CONSTRAINT IF EXISTS team_member_permissions_team_member_id_resource_key_action_key_key;

ALTER TABLE public.team_member_permissions
  ADD CONSTRAINT team_member_permissions_scope_unique
  UNIQUE(team_member_id, resource_key, action_key, value);

COMMENT ON CONSTRAINT team_member_permissions_scope_unique ON public.team_member_permissions IS
  'Permite múltiplos escopos para view/export (várias linhas com valores diferentes); create/edit/delete continuam com uma única linha.';
