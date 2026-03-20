-- Feature flag for external cadastro integration (Sistema Millennials)
-- Only enabled for org 6030520a-2ca7-477d-be89-55758e2cd808 via organization_features override.

INSERT INTO public.feature_flags (key, name, display_name, description, category, icon, feature_type, default_enabled, requires_plan, position)
VALUES (
  'external_cadastro',
  'Cadastro Externo',
  'Cadastro Externo',
  'Modal de cadastro automático no sistema externo ao fechar venda',
  'integrations',
  'UserPlus',
  'advanced',
  false,
  ARRAY[]::text[],
  40
)
ON CONFLICT (key) DO NOTHING;

-- Enable only for the specific organization
INSERT INTO public.organization_features (organization_id, feature_key, enabled, override_reason)
VALUES (
  '6030520a-2ca7-477d-be89-55758e2cd808',
  'external_cadastro',
  true,
  'Integração com Sistema Millennials - cadastro automático de clientes'
)
ON CONFLICT (organization_id, feature_key) DO UPDATE SET
  enabled = true,
  override_reason = EXCLUDED.override_reason,
  overridden_at = NOW();
