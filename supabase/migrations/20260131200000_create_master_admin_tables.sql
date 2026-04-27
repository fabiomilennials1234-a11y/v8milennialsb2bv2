-- Migration: Master Admin Tables
-- Description: Cria estrutura para area administrativa Master/Dev
-- Date: 2026-01-31

-- ============================================
-- FASE 1: Tabela master_users
-- ============================================

CREATE TABLE IF NOT EXISTS public.master_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES auth.users(id),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  permissions JSONB DEFAULT '{"all": true}',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_master_user UNIQUE (user_id)
);

COMMENT ON TABLE public.master_users IS 'Usuarios com acesso master/dev ao sistema inteiro';
COMMENT ON COLUMN public.master_users.permissions IS 'Permissoes granulares: {"all": true} ou {"orgs": true, "users": false, ...}';

-- Index
CREATE INDEX IF NOT EXISTS idx_master_users_user_id ON public.master_users(user_id);
CREATE INDEX IF NOT EXISTS idx_master_users_active ON public.master_users(is_active) WHERE is_active = true;

-- ============================================
-- FASE 2: Tabela subscription_plans
-- ============================================

CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  price_monthly NUMERIC DEFAULT 0,
  price_yearly NUMERIC DEFAULT 0,
  features JSONB NOT NULL DEFAULT '{}',
  limits JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.subscription_plans IS 'Planos de assinatura disponiveis';
COMMENT ON COLUMN public.subscription_plans.features IS 'Features incluidas: {"copilot": true, "whatsapp": true, ...}';
COMMENT ON COLUMN public.subscription_plans.limits IS 'Limites do plano: {"leads": 1000, "users": 5, "campaigns": 10, ...}';

-- Index
CREATE INDEX IF NOT EXISTS idx_subscription_plans_active ON public.subscription_plans(is_active, position);

-- Inserir planos padrão
INSERT INTO public.subscription_plans (name, display_name, description, price_monthly, price_yearly, features, limits, position, is_default) VALUES
  ('free', 'Free', 'Plano gratuito com recursos limitados', 0, 0, 
   '{"leads": true, "campaigns": true, "copilot": false, "whatsapp": false, "api": false}',
   '{"leads": 100, "users": 2, "campaigns": 1}',
   0, true),
  ('starter', 'Starter', 'Ideal para pequenas equipes', 97, 970,
   '{"leads": true, "campaigns": true, "copilot": true, "whatsapp": true, "api": false}',
   '{"leads": 1000, "users": 5, "campaigns": 5}',
   1, false),
  ('pro', 'Pro', 'Para equipes em crescimento', 197, 1970,
   '{"leads": true, "campaigns": true, "copilot": true, "whatsapp": true, "api": true}',
   '{"leads": 5000, "users": 15, "campaigns": 20}',
   2, false),
  ('enterprise', 'Enterprise', 'Recursos ilimitados para grandes operacoes', 497, 4970,
   '{"leads": true, "campaigns": true, "copilot": true, "whatsapp": true, "api": true, "custom_integrations": true}',
   '{"leads": -1, "users": -1, "campaigns": -1}',
   3, false)
ON CONFLICT (name) DO NOTHING;

-- ============================================
-- FASE 3: Tabelas feature_flags e organization_features
-- ============================================

CREATE TABLE IF NOT EXISTS public.feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'general',
  default_enabled BOOLEAN DEFAULT false,
  requires_plan TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.feature_flags IS 'Definicao global de feature flags';
COMMENT ON COLUMN public.feature_flags.requires_plan IS 'Planos que tem essa feature por padrao';

-- Index
CREATE INDEX IF NOT EXISTS idx_feature_flags_key ON public.feature_flags(key);
CREATE INDEX IF NOT EXISTS idx_feature_flags_category ON public.feature_flags(category);

-- Inserir features padrão
INSERT INTO public.feature_flags (key, name, description, category, default_enabled, requires_plan) VALUES
  ('copilot', 'Copilot IA', 'Acesso ao agente de IA conversacional', 'ai', false, ARRAY['starter', 'pro', 'enterprise']),
  ('copilot_advanced', 'Copilot Avancado', 'Funcoes avancadas do Copilot (follow-up, qualificacao)', 'ai', false, ARRAY['pro', 'enterprise']),
  ('whatsapp_integration', 'Integracao WhatsApp', 'Envio e recebimento de mensagens WhatsApp', 'integrations', false, ARRAY['starter', 'pro', 'enterprise']),
  ('whatsapp_bulk', 'Disparo em Massa', 'Disparo de mensagens em lote', 'integrations', false, ARRAY['pro', 'enterprise']),
  ('api_access', 'Acesso API', 'Acesso a API publica', 'integrations', false, ARRAY['pro', 'enterprise']),
  ('custom_reports', 'Relatorios Customizados', 'Criacao de relatorios personalizados', 'analytics', false, ARRAY['pro', 'enterprise']),
  ('tv_dashboard', 'TV Dashboard', 'Dashboard para exibicao em TV', 'analytics', false, ARRAY['starter', 'pro', 'enterprise']),
  ('multi_pipeline', 'Multi Pipeline', 'Multiplos pipelines de vendas', 'sales', false, ARRAY['pro', 'enterprise']),
  ('gamification', 'Gamificacao', 'Sistema de pontos e rankings', 'engagement', true, ARRAY['free', 'starter', 'pro', 'enterprise']),
  ('white_label', 'White Label', 'Personalizacao de marca', 'branding', false, ARRAY['enterprise'])
ON CONFLICT (key) DO NOTHING;

-- Tabela de features por organizacao (overrides)
CREATE TABLE IF NOT EXISTS public.organization_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL REFERENCES public.feature_flags(key) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT true,
  override_reason TEXT,
  overridden_by UUID REFERENCES auth.users(id),
  overridden_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_org_feature UNIQUE (organization_id, feature_key)
);

COMMENT ON TABLE public.organization_features IS 'Override de features por organizacao';

-- Index
CREATE INDEX IF NOT EXISTS idx_org_features_org ON public.organization_features(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_features_key ON public.organization_features(feature_key);
CREATE INDEX IF NOT EXISTS idx_org_features_expires ON public.organization_features(expires_at) WHERE expires_at IS NOT NULL;

-- ============================================
-- FASE 4: Tabela master_audit_logs
-- ============================================

CREATE TABLE IF NOT EXISTS public.master_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_user_id UUID NOT NULL REFERENCES public.master_users(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID,
  target_name TEXT,
  details JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.master_audit_logs IS 'Log de todas as acoes realizadas por usuarios master';

-- Index
CREATE INDEX IF NOT EXISTS idx_master_audit_logs_master ON public.master_audit_logs(master_user_id);
CREATE INDEX IF NOT EXISTS idx_master_audit_logs_action ON public.master_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_master_audit_logs_target ON public.master_audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_master_audit_logs_created ON public.master_audit_logs(created_at DESC);

-- ============================================
-- FASE 5: Atualizar tabela organizations
-- ============================================

ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES public.subscription_plans(id),
ADD COLUMN IF NOT EXISTS billing_override BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS billing_override_reason TEXT,
ADD COLUMN IF NOT EXISTS billing_override_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS billing_override_at TIMESTAMPTZ;

-- Index
CREATE INDEX IF NOT EXISTS idx_organizations_plan ON public.organizations(plan_id);
CREATE INDEX IF NOT EXISTS idx_organizations_billing_override ON public.organizations(billing_override) WHERE billing_override = true;

-- ============================================
-- FASE 6: Tabela impersonation_sessions (opcional)
-- ============================================

CREATE TABLE IF NOT EXISTS public.impersonation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_user_id UUID NOT NULL REFERENCES public.master_users(id) ON DELETE CASCADE,
  target_user_id UUID NOT NULL REFERENCES auth.users(id),
  target_organization_id UUID REFERENCES public.organizations(id),
  reason TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true
);

COMMENT ON TABLE public.impersonation_sessions IS 'Sessoes de impersonacao de usuarios pelo master';

-- Index
CREATE INDEX IF NOT EXISTS idx_impersonation_master ON public.impersonation_sessions(master_user_id);
CREATE INDEX IF NOT EXISTS idx_impersonation_active ON public.impersonation_sessions(is_active) WHERE is_active = true;

-- ============================================
-- FASE 7: Funcao is_master_user
-- ============================================

CREATE OR REPLACE FUNCTION public.is_master_user(_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.master_users
    WHERE user_id = _user_id
    AND is_active = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION public.is_master_user IS 'Verifica se o usuario eh um master/dev';

-- ============================================
-- FASE 8: Funcao para verificar feature
-- ============================================

CREATE OR REPLACE FUNCTION public.has_feature(_org_id UUID, _feature_key TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  v_override RECORD;
  v_plan RECORD;
  v_feature RECORD;
BEGIN
  -- Master sempre tem todas as features
  IF public.is_master_user() THEN
    RETURN true;
  END IF;

  -- Verificar override especifico da organizacao
  SELECT * INTO v_override
  FROM public.organization_features
  WHERE organization_id = _org_id
    AND feature_key = _feature_key
    AND (expires_at IS NULL OR expires_at > NOW());

  IF FOUND THEN
    RETURN v_override.enabled;
  END IF;

  -- Verificar se o plano da org inclui a feature
  SELECT o.subscription_plan, sp.features INTO v_plan
  FROM public.organizations o
  LEFT JOIN public.subscription_plans sp ON sp.name = o.subscription_plan
  WHERE o.id = _org_id;

  IF v_plan.features IS NOT NULL AND (v_plan.features->>_feature_key)::boolean = true THEN
    RETURN true;
  END IF;

  -- Verificar feature flag padrao
  SELECT * INTO v_feature
  FROM public.feature_flags
  WHERE key = _feature_key;

  IF FOUND THEN
    RETURN v_feature.default_enabled;
  END IF;

  RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION public.has_feature IS 'Verifica se uma organizacao tem acesso a uma feature';

-- ============================================
-- FASE 9: Funcoes de override para Master
-- ============================================

CREATE OR REPLACE FUNCTION public.master_override_billing(
  _org_id UUID,
  _plan TEXT,
  _reason TEXT,
  _expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_master_id UUID;
BEGIN
  IF NOT public.is_master_user() THEN
    RAISE EXCEPTION 'Acesso negado: apenas usuarios master podem executar esta acao';
  END IF;

  -- Buscar ID do master
  SELECT id INTO v_master_id FROM public.master_users WHERE user_id = auth.uid();

  -- Atualizar organizacao
  UPDATE public.organizations SET
    subscription_status = 'active',
    subscription_plan = _plan,
    subscription_expires_at = COALESCE(_expires_at, NOW() + INTERVAL '100 years'),
    billing_override = true,
    billing_override_reason = _reason,
    billing_override_by = auth.uid(),
    billing_override_at = NOW(),
    updated_at = NOW()
  WHERE id = _org_id;

  -- Log da acao
  INSERT INTO public.master_audit_logs (master_user_id, user_id, action, target_type, target_id, details)
  VALUES (
    v_master_id,
    auth.uid(),
    'BILLING_OVERRIDE',
    'organization',
    _org_id,
    jsonb_build_object(
      'plan', _plan,
      'reason', _reason,
      'expires_at', _expires_at
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.master_override_billing IS 'Permite ao master liberar plano manualmente para uma organizacao';

-- Funcao para ativar feature individual
CREATE OR REPLACE FUNCTION public.master_enable_feature(
  _org_id UUID,
  _feature_key TEXT,
  _reason TEXT,
  _expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_master_id UUID;
BEGIN
  IF NOT public.is_master_user() THEN
    RAISE EXCEPTION 'Acesso negado: apenas usuarios master podem executar esta acao';
  END IF;

  -- Buscar ID do master
  SELECT id INTO v_master_id FROM public.master_users WHERE user_id = auth.uid();

  -- Inserir ou atualizar feature override
  INSERT INTO public.organization_features (organization_id, feature_key, enabled, override_reason, overridden_by, expires_at)
  VALUES (_org_id, _feature_key, true, _reason, auth.uid(), _expires_at)
  ON CONFLICT (organization_id, feature_key)
  DO UPDATE SET 
    enabled = true,
    override_reason = _reason,
    overridden_by = auth.uid(),
    overridden_at = NOW(),
    expires_at = _expires_at;

  -- Log
  INSERT INTO public.master_audit_logs (master_user_id, user_id, action, target_type, target_id, details)
  VALUES (
    v_master_id,
    auth.uid(),
    'FEATURE_ENABLE',
    'organization',
    _org_id,
    jsonb_build_object(
      'feature', _feature_key,
      'reason', _reason,
      'expires_at', _expires_at
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Funcao para desativar feature
CREATE OR REPLACE FUNCTION public.master_disable_feature(
  _org_id UUID,
  _feature_key TEXT,
  _reason TEXT
)
RETURNS VOID AS $$
DECLARE
  v_master_id UUID;
BEGIN
  IF NOT public.is_master_user() THEN
    RAISE EXCEPTION 'Acesso negado: apenas usuarios master podem executar esta acao';
  END IF;

  SELECT id INTO v_master_id FROM public.master_users WHERE user_id = auth.uid();

  INSERT INTO public.organization_features (organization_id, feature_key, enabled, override_reason, overridden_by)
  VALUES (_org_id, _feature_key, false, _reason, auth.uid())
  ON CONFLICT (organization_id, feature_key)
  DO UPDATE SET 
    enabled = false,
    override_reason = _reason,
    overridden_by = auth.uid(),
    overridden_at = NOW(),
    expires_at = NULL;

  INSERT INTO public.master_audit_logs (master_user_id, user_id, action, target_type, target_id, details)
  VALUES (
    v_master_id,
    auth.uid(),
    'FEATURE_DISABLE',
    'organization',
    _org_id,
    jsonb_build_object('feature', _feature_key, 'reason', _reason)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- FASE 10: RLS para tabelas master
-- ============================================

ALTER TABLE public.master_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.impersonation_sessions ENABLE ROW LEVEL SECURITY;

-- master_users: apenas masters podem ver/editar
CREATE POLICY "master_users_select" ON public.master_users FOR SELECT
  USING (public.is_master_user() OR user_id = auth.uid());

CREATE POLICY "master_users_all" ON public.master_users FOR ALL
  USING (public.is_master_user());

-- subscription_plans: todos podem ver, apenas masters podem editar
CREATE POLICY "subscription_plans_select" ON public.subscription_plans FOR SELECT
  USING (true);

CREATE POLICY "subscription_plans_all" ON public.subscription_plans FOR ALL
  USING (public.is_master_user());

-- feature_flags: todos podem ver, apenas masters podem editar
CREATE POLICY "feature_flags_select" ON public.feature_flags FOR SELECT
  USING (true);

CREATE POLICY "feature_flags_all" ON public.feature_flags FOR ALL
  USING (public.is_master_user());

-- organization_features: org members podem ver suas, masters podem ver todas
CREATE POLICY "org_features_select_own" ON public.organization_features FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    OR public.is_master_user()
  );

CREATE POLICY "org_features_all" ON public.organization_features FOR ALL
  USING (public.is_master_user());

-- master_audit_logs: apenas masters
CREATE POLICY "master_audit_logs_select" ON public.master_audit_logs FOR SELECT
  USING (public.is_master_user());

CREATE POLICY "master_audit_logs_insert" ON public.master_audit_logs FOR INSERT
  WITH CHECK (public.is_master_user());

-- impersonation_sessions: apenas masters
CREATE POLICY "impersonation_sessions_all" ON public.impersonation_sessions FOR ALL
  USING (public.is_master_user());

-- ============================================
-- FIM DA MIGRATION
-- ============================================
