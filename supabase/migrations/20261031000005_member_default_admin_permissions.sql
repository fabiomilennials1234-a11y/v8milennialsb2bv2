-- Generaliza modelo de permissões: membro herda todas as features do admin por
-- default. Admin pode desativar features individuais por membro via
-- Configurações → Equipe → Permissões (`member_feature_permissions`).
--
-- Passos:
--   1. Cadastrar features granulares de gates que antes eram admin-only
--      hardcoded no frontend (`leads.reassign`, `leads.remove_from_pipe`).
--   2. Flippar TODAS as features para default_value=true / is_admin_only=false.
--      A UI de permissões (`MemberPermissions.tsx`) trata `is_admin_only=true`
--      como switch desabilitado — flippar libera o admin a desativar.
--   3. Org-role permissions (`see_all_leads`, `see_general_info`,
--      `see_subordinates_cards`, `see_unassigned_cards`) passam a default=true
--      para roles não-admin (member/sdr/closer). Override individual continua
--      em `team_member_org_permissions`.

INSERT INTO public.feature_permissions
  (key, module, name, description, is_admin_only, default_value, sort_order)
VALUES
  (
    'leads.reassign',
    'Leads',
    'Atribuir responsáveis',
    'Permite alterar os responsáveis (pré-venda / venda) de um lead.',
    false,
    true,
    100
  ),
  (
    'leads.remove_from_pipe',
    'Leads',
    'Remover de pipe',
    'Permite remover um lead de um funil.',
    false,
    true,
    101
  )
ON CONFLICT (key) DO NOTHING;

UPDATE public.feature_permissions
SET default_value = true,
    is_admin_only = false;

UPDATE public.organization_role_permissions
SET enabled = true
WHERE role IN ('member', 'sdr', 'closer');
