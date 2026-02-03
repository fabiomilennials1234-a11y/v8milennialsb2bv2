-- Garantir constraint multi-scope: UNIQUE(team_member_id, resource_key, action_key, value)
-- Permite múltiplas linhas por (membro, recurso, ação) com valores diferentes (Ver/Exportar).
-- Idempotente: remove antiga se existir, adiciona a nova.
-- Data: 2026-02-23

ALTER TABLE public.team_member_permissions
  DROP CONSTRAINT IF EXISTS team_member_permissions_team_member_id_resource_key_action_key_key;

ALTER TABLE public.team_member_permissions
  DROP CONSTRAINT IF EXISTS team_member_permissions_scope_unique;

ALTER TABLE public.team_member_permissions
  ADD CONSTRAINT team_member_permissions_scope_unique
  UNIQUE(team_member_id, resource_key, action_key, value);

COMMENT ON CONSTRAINT team_member_permissions_scope_unique ON public.team_member_permissions IS
  'Permite múltiplos escopos para view/export (várias linhas com valores diferentes); create/edit/delete continuam com uma única linha.';
