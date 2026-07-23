-- Adiciona feature granular `leads.reassign` para controlar quem pode trocar
-- os responsáveis (pre_sale / sale) num lead. Default = denied para membros;
-- admin/master continuam liberados via cascade do permission engine.
-- Override por membro via `member_feature_permissions`.

INSERT INTO public.feature_permissions
  (key, module, name, description, is_admin_only, default_value, sort_order)
VALUES
  (
    'leads.reassign',
    'Leads',
    'Atribuir responsáveis',
    'Permite alterar os responsáveis (pré-venda / venda) de um lead.',
    false,
    false,
    100
  )
ON CONFLICT (key) DO NOTHING;
