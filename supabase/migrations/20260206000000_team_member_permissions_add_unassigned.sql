-- Adicionar valor 'unassigned' em team_member_permissions.value (ver cards sem responsável)
-- Data: 2026-02-06

ALTER TABLE public.team_member_permissions
  DROP CONSTRAINT IF EXISTS team_member_permissions_value_check;

ALTER TABLE public.team_member_permissions
  ADD CONSTRAINT team_member_permissions_value_check
  CHECK (value IN ('denied', 'allowed', 'if_responsible', 'team_access', 'unassigned'));
