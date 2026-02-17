-- ================================================================
-- Migration: Plan Features Enforcement System
-- Expande feature_flags, atualiza subscription_plans com features
-- e limites granulares, cria funções de verificação de acesso.
-- Date: 2026-02-17
-- ================================================================

-- ============================================
-- FASE 1: Expandir feature_flags com novos campos
-- ============================================

ALTER TABLE public.feature_flags
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS icon TEXT,
  ADD COLUMN IF NOT EXISTS sidebar_path TEXT,
  ADD COLUMN IF NOT EXISTS feature_type TEXT DEFAULT 'boolean',
  ADD COLUMN IF NOT EXISTS position INTEGER DEFAULT 0;

COMMENT ON COLUMN public.feature_flags.display_name IS 'Nome amigavel para exibicao no editor de planos';
COMMENT ON COLUMN public.feature_flags.icon IS 'Nome do icone Lucide para UI';
COMMENT ON COLUMN public.feature_flags.sidebar_path IS 'Path da sidebar associado (para lock visual)';
COMMENT ON COLUMN public.feature_flags.feature_type IS 'Tipo: boolean (modulo), campaign_type, advanced';
COMMENT ON COLUMN public.feature_flags.position IS 'Ordem de exibicao no editor';

-- ============================================
-- FASE 2: Atualizar features existentes com novos campos
-- ============================================

UPDATE public.feature_flags SET
  display_name = 'Copilot IA', icon = 'Bot', sidebar_path = '/copilot',
  feature_type = 'boolean', category = 'modules', position = 10
WHERE key = 'copilot';

UPDATE public.feature_flags SET
  display_name = 'Copilot Avancado', icon = 'Sparkles',
  feature_type = 'advanced', category = 'advanced', position = 30
WHERE key = 'copilot_advanced';

UPDATE public.feature_flags SET
  display_name = 'WhatsApp Integracao', icon = 'Zap',
  feature_type = 'advanced', category = 'advanced', position = 35
WHERE key = 'whatsapp_integration';

UPDATE public.feature_flags SET
  display_name = 'Disparo em Massa', icon = 'Send',
  feature_type = 'advanced', category = 'advanced', position = 31
WHERE key = 'whatsapp_bulk';

UPDATE public.feature_flags SET
  display_name = 'Acesso API', icon = 'Code',
  feature_type = 'advanced', category = 'advanced', position = 32
WHERE key = 'api_access';

UPDATE public.feature_flags SET
  display_name = 'Relatorios Custom', icon = 'FileBarChart',
  feature_type = 'advanced', category = 'advanced', position = 36
WHERE key = 'custom_reports';

UPDATE public.feature_flags SET
  display_name = 'TV Dashboard', icon = 'Tv', sidebar_path = '/tv',
  feature_type = 'boolean', category = 'modules', position = 9
WHERE key = 'tv_dashboard';

UPDATE public.feature_flags SET
  display_name = 'Multi Pipeline', icon = 'GitBranch',
  feature_type = 'advanced', category = 'advanced', position = 37
WHERE key = 'multi_pipeline';

UPDATE public.feature_flags SET
  display_name = 'Gamificacao', icon = 'Gamepad2',
  feature_type = 'advanced', category = 'advanced', position = 38
WHERE key = 'gamification';

UPDATE public.feature_flags SET
  display_name = 'White Label', icon = 'Palette',
  feature_type = 'advanced', category = 'advanced', position = 33
WHERE key = 'white_label';

-- ============================================
-- FASE 3: Inserir novas features (módulos sidebar + campaign types)
-- ============================================

INSERT INTO public.feature_flags
  (key, name, display_name, description, category, icon, sidebar_path, feature_type, default_enabled, requires_plan, position)
VALUES
  -- Módulos sidebar (10 features)
  ('chat', 'Chat WhatsApp', 'Chat', 'Modulo de chat e mensagens WhatsApp', 'modules', 'Zap', '/chat-whatsapp', 'boolean', true, ARRAY['free','starter','pro','enterprise'], 1),
  ('funnels', 'Funis de Vendas', 'Funis', 'Pipelines de qualificacao, confirmacao e propostas', 'modules', 'GitBranch', '/funis', 'boolean', true, ARRAY['free','starter','pro','enterprise'], 2),
  ('review', 'Revisao / Follow-ups', 'Revisao', 'Modulo de revisao e follow-ups', 'modules', 'Wrench', '/follow-ups', 'boolean', true, ARRAY['free','starter','pro','enterprise'], 3),
  ('leads', 'Combustivel (Leads)', 'Combustivel', 'Gestao de leads e contatos', 'modules', 'Fuel', '/leads', 'boolean', true, ARRAY['free','starter','pro','enterprise'], 4),
  ('commissions', 'Comissoes', 'Comissoes', 'Modulo de comissoes e pagamentos', 'modules', 'DollarSign', '/comissoes', 'boolean', false, ARRAY['starter','pro','enterprise'], 5),
  ('performance', 'Podio (Performance)', 'Podio', 'Modulo de performance, ranking e metas', 'modules', 'Trophy', '/performance', 'boolean', true, ARRAY['free','starter','pro','enterprise'], 6),
  ('marketing', 'Marketing', 'Marketing', 'Modulo de marketing e analises', 'modules', 'BarChart2', '/marketing', 'boolean', false, ARRAY['starter','pro','enterprise'], 7),
  ('products', 'Produtos', 'Produtos', 'Catalogo de produtos', 'modules', 'Package', '/produtos', 'boolean', true, ARRAY['free','starter','pro','enterprise'], 8),
  -- Campaign types (3 features)
  ('campaigns_manual', 'Campanhas Manuais', 'Campanhas Manuais', 'Criacao de campanhas manuais via Kanban', 'campaigns', 'MousePointer', NULL, 'campaign_type', true, ARRAY['free','starter','pro','enterprise'], 20),
  ('campaigns_semi', 'Campanhas Semi-Automaticas', 'Campanhas Semi-Auto', 'Campanhas com disparo de templates em lote', 'campaigns', 'Zap', NULL, 'campaign_type', false, ARRAY['starter','pro','enterprise'], 21),
  ('campaigns_auto', 'Campanhas Automaticas', 'Campanhas Automaticas', 'Campanhas com IA conversacional', 'campaigns', 'Bot', NULL, 'campaign_type', false, ARRAY['pro','enterprise'], 22)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  icon = EXCLUDED.icon,
  sidebar_path = EXCLUDED.sidebar_path,
  feature_type = EXCLUDED.feature_type,
  default_enabled = EXCLUDED.default_enabled,
  requires_plan = EXCLUDED.requires_plan,
  position = EXCLUDED.position;

-- ============================================
-- FASE 4: Atualizar subscription_plans com features e limites expandidos
-- ============================================

-- Free plan
UPDATE public.subscription_plans SET
  features = '{
    "chat": true, "funnels": true, "review": true, "leads": true,
    "copilot": false, "commissions": false, "performance": true,
    "marketing": false, "tv_dashboard": false, "products": true,
    "campaigns_manual": true, "campaigns_semi": false, "campaigns_auto": false,
    "copilot_advanced": false, "whatsapp_bulk": false, "api_access": false, "white_label": false
  }'::JSONB,
  limits = '{
    "max_leads": 100, "max_users": 2, "max_campaigns": 1,
    "max_copilot_agents": 0, "max_whatsapp_instances": 1,
    "max_funnels": 1, "max_documents_per_agent": 0
  }'::JSONB
WHERE name = 'free';

-- Starter plan
UPDATE public.subscription_plans SET
  features = '{
    "chat": true, "funnels": true, "review": true, "leads": true,
    "copilot": true, "commissions": true, "performance": true,
    "marketing": true, "tv_dashboard": true, "products": true,
    "campaigns_manual": true, "campaigns_semi": true, "campaigns_auto": false,
    "copilot_advanced": false, "whatsapp_bulk": false, "api_access": false, "white_label": false
  }'::JSONB,
  limits = '{
    "max_leads": 1000, "max_users": 5, "max_campaigns": 5,
    "max_copilot_agents": 2, "max_whatsapp_instances": 1,
    "max_funnels": 3, "max_documents_per_agent": 5
  }'::JSONB
WHERE name = 'starter';

-- Pro plan
UPDATE public.subscription_plans SET
  features = '{
    "chat": true, "funnels": true, "review": true, "leads": true,
    "copilot": true, "commissions": true, "performance": true,
    "marketing": true, "tv_dashboard": true, "products": true,
    "campaigns_manual": true, "campaigns_semi": true, "campaigns_auto": true,
    "copilot_advanced": true, "whatsapp_bulk": true, "api_access": true, "white_label": false
  }'::JSONB,
  limits = '{
    "max_leads": 5000, "max_users": 15, "max_campaigns": 20,
    "max_copilot_agents": 10, "max_whatsapp_instances": 3,
    "max_funnels": 10, "max_documents_per_agent": 20
  }'::JSONB
WHERE name = 'pro';

-- Enterprise plan
UPDATE public.subscription_plans SET
  features = '{
    "chat": true, "funnels": true, "review": true, "leads": true,
    "copilot": true, "commissions": true, "performance": true,
    "marketing": true, "tv_dashboard": true, "products": true,
    "campaigns_manual": true, "campaigns_semi": true, "campaigns_auto": true,
    "copilot_advanced": true, "whatsapp_bulk": true, "api_access": true, "white_label": true
  }'::JSONB,
  limits = '{
    "max_leads": -1, "max_users": -1, "max_campaigns": -1,
    "max_copilot_agents": -1, "max_whatsapp_instances": -1,
    "max_funnels": -1, "max_documents_per_agent": -1
  }'::JSONB
WHERE name = 'enterprise';

-- ============================================
-- FASE 5: Adicionar limit_overrides às organizações
-- ============================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS limit_overrides JSONB DEFAULT '{}';

COMMENT ON COLUMN public.organizations.limit_overrides IS 'Override de limites por org: {"max_leads": 500, ...}. -1 = ilimitado.';

-- ============================================
-- FASE 6: Função org_check_limit
-- ============================================

CREATE OR REPLACE FUNCTION public.org_check_limit(p_org_id UUID, p_limit_key TEXT)
RETURNS INTEGER AS $$
DECLARE
  v_org RECORD;
  v_plan_limits JSONB;
BEGIN
  -- Master sempre tem ilimitado
  IF public.is_master_user() THEN
    RETURN -1;
  END IF;

  -- Buscar org com overrides
  SELECT o.limit_overrides, o.subscription_plan
  INTO v_org
  FROM public.organizations o
  WHERE o.id = p_org_id;

  -- 1. Verificar override de limite na org
  IF v_org.limit_overrides IS NOT NULL AND v_org.limit_overrides ? p_limit_key THEN
    RETURN (v_org.limit_overrides ->> p_limit_key)::INTEGER;
  END IF;

  -- 2. Verificar limite no plano da org
  SELECT sp.limits INTO v_plan_limits
  FROM public.subscription_plans sp
  WHERE sp.name = v_org.subscription_plan;

  IF v_plan_limits IS NOT NULL AND v_plan_limits ? p_limit_key THEN
    RETURN (v_plan_limits ->> p_limit_key)::INTEGER;
  END IF;

  -- 3. Default: 0 (sem acesso)
  RETURN 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION public.org_check_limit IS 'Retorna o limite de um recurso para uma org. -1 = ilimitado, 0 = sem acesso.';

-- ============================================
-- FASE 7: Função batch para frontend (uma unica chamada)
-- ============================================

CREATE OR REPLACE FUNCTION public.org_get_features_and_limits(p_org_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_features JSONB := '{}';
  v_limits JSONB := '{}';
  v_plan_features JSONB;
  v_plan_limits JSONB;
  v_org RECORD;
  v_override RECORD;
  v_flag RECORD;
BEGIN
  -- Master: tudo habilitado e ilimitado
  IF public.is_master_user() THEN
    FOR v_flag IN SELECT key FROM public.feature_flags LOOP
      v_features := v_features || jsonb_build_object(v_flag.key, true);
    END LOOP;
    RETURN jsonb_build_object(
      'features', v_features,
      'limits', '{"max_leads":-1,"max_users":-1,"max_campaigns":-1,"max_copilot_agents":-1,"max_whatsapp_instances":-1,"max_funnels":-1,"max_documents_per_agent":-1}'::JSONB,
      'plan_name', 'master'
    );
  END IF;

  -- Buscar plano da org
  SELECT o.subscription_plan, o.limit_overrides,
         COALESCE(sp.features, '{}') AS plan_features,
         COALESCE(sp.limits, '{}') AS plan_limits
  INTO v_org
  FROM public.organizations o
  LEFT JOIN public.subscription_plans sp ON sp.name = o.subscription_plan
  WHERE o.id = p_org_id;

  v_plan_features := COALESCE(v_org.plan_features, '{}');
  v_plan_limits := COALESCE(v_org.plan_limits, '{}');

  -- Montar features: plano base
  v_features := v_plan_features;

  -- Aplicar overrides de features (organization_features)
  FOR v_override IN
    SELECT feature_key, enabled
    FROM public.organization_features
    WHERE organization_id = p_org_id
      AND (expires_at IS NULL OR expires_at > NOW())
  LOOP
    v_features := v_features || jsonb_build_object(v_override.feature_key, v_override.enabled);
  END LOOP;

  -- Para features nao presentes no plano, usar default_enabled
  FOR v_flag IN
    SELECT key, default_enabled FROM public.feature_flags
    WHERE NOT (v_features ? key)
  LOOP
    v_features := v_features || jsonb_build_object(v_flag.key, v_flag.default_enabled);
  END LOOP;

  -- Montar limites: plano base + overrides
  v_limits := v_plan_limits;
  IF v_org.limit_overrides IS NOT NULL AND v_org.limit_overrides != '{}'::JSONB THEN
    v_limits := v_limits || v_org.limit_overrides;
  END IF;

  RETURN jsonb_build_object(
    'features', v_features,
    'limits', v_limits,
    'plan_name', COALESCE(v_org.subscription_plan, 'free')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION public.org_get_features_and_limits IS 'Retorna todas as features e limites de uma org em uma unica chamada (otimizado para frontend)';

-- ============================================
-- FIM DA MIGRATION
-- ============================================
