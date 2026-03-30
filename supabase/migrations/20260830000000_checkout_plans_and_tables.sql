-- ================================================================
-- Migration: Checkout Plans and Tables
-- Estende subscription_plans, desativa planos legados, insere novos
-- planos Torque, cria plan_addons, coupons, org_subscriptions,
-- payment_history e RPC validate_coupon.
-- Date: 2026-08-30
-- ================================================================

-- ============================================
-- FASE 1: Estender subscription_plans
-- ============================================

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS price_per_user_monthly   NUMERIC,
  ADD COLUMN IF NOT EXISTS base_price_monthly        NUMERIC,
  ADD COLUMN IF NOT EXISTS min_users                 INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS included_users            INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS included_copilots         INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_user_price          NUMERIC  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_semester_pct     NUMERIC  DEFAULT 10,
  ADD COLUMN IF NOT EXISTS discount_annual_pct       NUMERIC  DEFAULT 15,
  ADD COLUMN IF NOT EXISTS discount_volume_pct       NUMERIC  DEFAULT 35,
  ADD COLUMN IF NOT EXISTS discount_volume_min       INTEGER  DEFAULT 10;

COMMENT ON COLUMN public.subscription_plans.price_per_user_monthly  IS 'Preço por usuário/mês (planos per-seat)';
COMMENT ON COLUMN public.subscription_plans.base_price_monthly       IS 'Preço base mensal fixo (planos com base + extra)';
COMMENT ON COLUMN public.subscription_plans.min_users                IS 'Mínimo de usuários exigidos no plano';
COMMENT ON COLUMN public.subscription_plans.included_users           IS 'Usuários já incluídos no preço base';
COMMENT ON COLUMN public.subscription_plans.included_copilots        IS 'Copilots Turbo incluídos no preço base';
COMMENT ON COLUMN public.subscription_plans.extra_user_price         IS 'Preço por usuário adicional além dos incluídos';
COMMENT ON COLUMN public.subscription_plans.discount_semester_pct    IS 'Desconto (%) para ciclo semestral';
COMMENT ON COLUMN public.subscription_plans.discount_annual_pct      IS 'Desconto (%) para ciclo anual';
COMMENT ON COLUMN public.subscription_plans.discount_volume_pct      IS 'Desconto (%) de volume quando ≥ discount_volume_min usuários';
COMMENT ON COLUMN public.subscription_plans.discount_volume_min      IS 'Número mínimo de usuários para ativar desconto de volume';

-- ============================================
-- FASE 2: Desativar planos legados
-- ============================================

UPDATE public.subscription_plans
SET is_active = false
WHERE name IN ('free', 'starter', 'pro', 'enterprise');

-- ============================================
-- FASE 3: Inserir novos planos Torque
-- ============================================

INSERT INTO public.subscription_plans (
  name,
  display_name,
  description,
  price_monthly,
  price_yearly,
  price_per_user_monthly,
  base_price_monthly,
  min_users,
  included_users,
  included_copilots,
  extra_user_price,
  discount_semester_pct,
  discount_annual_pct,
  discount_volume_pct,
  discount_volume_min,
  features,
  limits,
  is_active,
  is_default,
  position
) VALUES

-- torque-1.0 -------------------------------------------------------
(
  'torque-1.0',
  'Torque 1.0',
  'Plano por usuário para equipes em crescimento. Mínimo 2 usuários.',
  -- price_monthly calculado como referência (2 users * R$297)
  594,
  -- price_yearly (placeholder; calculado dinamicamente no checkout)
  0,
  297,   -- price_per_user_monthly
  NULL,  -- base_price_monthly (per-seat, sem base fixa)
  2,     -- min_users
  0,     -- included_users
  0,     -- included_copilots
  297,   -- extra_user_price
  10,    -- discount_semester_pct
  15,    -- discount_annual_pct
  35,    -- discount_volume_pct
  10,    -- discount_volume_min
  '{
    "leads": true,
    "funnels": true,
    "performance": true,
    "products": true,
    "analytics": true,
    "chat": false,
    "carteira": false,
    "copilot": false,
    "oraculo": false,
    "scheduled_messages": false,
    "automations": false,
    "whatsapp_bulk": false
  }'::JSONB,
  '{
    "max_leads": -1,
    "max_users": -1,
    "max_campaigns": -1,
    "max_copilot_agents": 0,
    "max_whatsapp_instances": 0,
    "max_funnels": -1,
    "max_documents_per_agent": 0
  }'::JSONB,
  true,
  false,
  10
),

-- torque-2.0 -------------------------------------------------------
(
  'torque-2.0',
  'Torque 2.0',
  'Plano por usuário com todos os módulos exceto Copilot e Oráculo. Mínimo 3 usuários.',
  -- price_monthly calculado como referência (3 users * R$697)
  2091,
  0,
  697,   -- price_per_user_monthly
  NULL,  -- base_price_monthly
  3,     -- min_users
  0,     -- included_users
  0,     -- included_copilots
  697,   -- extra_user_price
  10,
  15,
  35,
  10,
  '{
    "leads": true,
    "funnels": true,
    "performance": true,
    "products": true,
    "analytics": true,
    "chat": true,
    "carteira": true,
    "copilot": false,
    "oraculo": false,
    "scheduled_messages": true,
    "automations": true,
    "whatsapp_bulk": true
  }'::JSONB,
  '{
    "max_leads": -1,
    "max_users": -1,
    "max_campaigns": -1,
    "max_copilot_agents": 0,
    "max_whatsapp_instances": -1,
    "max_funnels": -1,
    "max_documents_per_agent": 0
  }'::JSONB,
  true,
  false,
  20
),

-- torque-v8 --------------------------------------------------------
(
  'torque-v8',
  'Torque V8',
  'Plano completo com base fixa, 3 usuários incluídos, 1 Copilot Turbo incluído e usuários extras a R$120. Mínimo 3 usuários.',
  -- price_monthly = base fixa R$1997
  1997,
  0,
  NULL,  -- price_per_user_monthly (sem per-seat; usa base + extra)
  1997,  -- base_price_monthly
  3,     -- min_users
  3,     -- included_users
  1,     -- included_copilots
  120,   -- extra_user_price
  10,
  15,
  35,
  10,
  '{
    "leads": true,
    "funnels": true,
    "performance": true,
    "products": true,
    "analytics": true,
    "chat": true,
    "carteira": true,
    "copilot": true,
    "oraculo": true,
    "scheduled_messages": true,
    "automations": true,
    "whatsapp_bulk": true
  }'::JSONB,
  '{
    "max_leads": -1,
    "max_users": -1,
    "max_campaigns": -1,
    "max_copilot_agents": -1,
    "max_whatsapp_instances": -1,
    "max_funnels": -1,
    "max_documents_per_agent": -1
  }'::JSONB,
  true,
  false,
  30
)

ON CONFLICT (name) DO UPDATE SET
  display_name          = EXCLUDED.display_name,
  description           = EXCLUDED.description,
  price_monthly         = EXCLUDED.price_monthly,
  price_yearly          = EXCLUDED.price_yearly,
  price_per_user_monthly = EXCLUDED.price_per_user_monthly,
  base_price_monthly    = EXCLUDED.base_price_monthly,
  min_users             = EXCLUDED.min_users,
  included_users        = EXCLUDED.included_users,
  included_copilots     = EXCLUDED.included_copilots,
  extra_user_price      = EXCLUDED.extra_user_price,
  discount_semester_pct = EXCLUDED.discount_semester_pct,
  discount_annual_pct   = EXCLUDED.discount_annual_pct,
  discount_volume_pct   = EXCLUDED.discount_volume_pct,
  discount_volume_min   = EXCLUDED.discount_volume_min,
  features              = EXCLUDED.features,
  limits                = EXCLUDED.limits,
  is_active             = EXCLUDED.is_active,
  position              = EXCLUDED.position,
  updated_at            = NOW();

-- ============================================
-- FASE 4: Tabela plan_addons
-- ============================================

CREATE TABLE IF NOT EXISTS public.plan_addons (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              TEXT        NOT NULL UNIQUE,
  display_name      TEXT        NOT NULL,
  price_monthly     NUMERIC     NOT NULL,
  unit_label        TEXT        NOT NULL DEFAULT 'unidade',
  applicable_plans  TEXT[]      NOT NULL DEFAULT '{}',
  features_unlocked TEXT[]      NOT NULL DEFAULT '{}',
  is_active         BOOLEAN     NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.plan_addons                  IS 'Addons opcionais disponíveis por plano (ex.: Turbo Copilot)';
COMMENT ON COLUMN public.plan_addons.slug             IS 'Identificador único do addon (ex.: turbo)';
COMMENT ON COLUMN public.plan_addons.applicable_plans IS 'Slugs dos planos que podem contratar este addon';
COMMENT ON COLUMN public.plan_addons.features_unlocked IS 'Feature keys que o addon desbloqueia na org';

CREATE INDEX IF NOT EXISTS idx_plan_addons_active
  ON public.plan_addons (is_active)
  WHERE is_active = true;

-- Addon: Turbo Copilot
INSERT INTO public.plan_addons (slug, display_name, price_monthly, unit_label, applicable_plans, features_unlocked, is_active)
VALUES (
  'turbo',
  'Turbo Copilot',
  1427,
  'copiloto',
  ARRAY['torque-1.0', 'torque-2.0'],
  ARRAY['copilot', 'oraculo'],
  true
)
ON CONFLICT (slug) DO UPDATE SET
  display_name      = EXCLUDED.display_name,
  price_monthly     = EXCLUDED.price_monthly,
  unit_label        = EXCLUDED.unit_label,
  applicable_plans  = EXCLUDED.applicable_plans,
  features_unlocked = EXCLUDED.features_unlocked,
  is_active         = EXCLUDED.is_active;

-- RLS — plan_addons
ALTER TABLE public.plan_addons ENABLE ROW LEVEL SECURITY;

-- Qualquer pessoa autenticada ou anônima pode ver addons ativos
CREATE POLICY "plan_addons_select_active"
  ON public.plan_addons FOR SELECT
  USING (is_active = true OR public.is_master_user());

-- Somente masters gerenciam addons
CREATE POLICY "plan_addons_all_masters"
  ON public.plan_addons FOR ALL
  USING (public.is_master_user())
  WITH CHECK (public.is_master_user());

-- ============================================
-- FASE 5: Tabela coupons
-- ============================================

CREATE TABLE IF NOT EXISTS public.coupons (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT        NOT NULL UNIQUE,
  discount_pct  NUMERIC     NOT NULL CHECK (discount_pct > 0 AND discount_pct <= 100),
  applies_to    TEXT[]      NOT NULL DEFAULT '{}',
  max_uses      INTEGER,
  current_uses  INTEGER     NOT NULL DEFAULT 0,
  valid_from    TIMESTAMPTZ,
  valid_until   TIMESTAMPTZ,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_by    UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.coupons              IS 'Cupons de desconto aplicáveis no checkout';
COMMENT ON COLUMN public.coupons.code         IS 'Código do cupom (case-insensitive na validação)';
COMMENT ON COLUMN public.coupons.applies_to   IS 'Slugs de planos aos quais o cupom se aplica. Vazio = todos.';
COMMENT ON COLUMN public.coupons.max_uses     IS 'Limite total de usos. NULL = ilimitado.';
COMMENT ON COLUMN public.coupons.current_uses IS 'Contador de usos efetivados';

CREATE INDEX IF NOT EXISTS idx_coupons_code
  ON public.coupons (UPPER(code));

CREATE INDEX IF NOT EXISTS idx_coupons_active
  ON public.coupons (is_active)
  WHERE is_active = true;

-- Cupom inicial: MILENNIALS35 — 35% em todos os planos
INSERT INTO public.coupons (code, discount_pct, applies_to, max_uses, valid_from, valid_until, is_active)
VALUES (
  'MILENNIALS35',
  35,
  ARRAY['torque-1.0', 'torque-2.0', 'torque-v8'],
  NULL,
  NOW(),
  NULL,
  true
)
ON CONFLICT (code) DO UPDATE SET
  discount_pct = EXCLUDED.discount_pct,
  applies_to   = EXCLUDED.applies_to,
  is_active    = EXCLUDED.is_active;

-- RLS — coupons
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

-- Qualquer um pode SELECT em cupons ativos (necessário para validação no checkout)
CREATE POLICY "coupons_select_active"
  ON public.coupons FOR SELECT
  USING (is_active = true OR public.is_master_user());

-- Somente masters gerenciam cupons
CREATE POLICY "coupons_all_masters"
  ON public.coupons FOR ALL
  USING (public.is_master_user())
  WITH CHECK (public.is_master_user());

-- ============================================
-- FASE 6: Tabela org_subscriptions
-- ============================================

CREATE TABLE IF NOT EXISTS public.org_subscriptions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id          UUID        NOT NULL REFERENCES public.subscription_plans(id),
  billing_cycle    TEXT        NOT NULL CHECK (billing_cycle IN ('monthly', 'semester', 'annual')),
  user_count       INTEGER     NOT NULL DEFAULT 1,
  addon_turbo_count INTEGER    NOT NULL DEFAULT 0,
  coupon_id        UUID        REFERENCES public.coupons(id) ON DELETE SET NULL,
  base_amount      NUMERIC     NOT NULL,
  discount_amount  NUMERIC     NOT NULL DEFAULT 0,
  final_amount     NUMERIC     NOT NULL,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  renews_at        TIMESTAMPTZ,
  cancelled_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.org_subscriptions                   IS 'Assinatura ativa de cada organização';
COMMENT ON COLUMN public.org_subscriptions.user_count        IS 'Quantidade de usuários no plano atual';
COMMENT ON COLUMN public.org_subscriptions.addon_turbo_count IS 'Quantidade de licenças Turbo Copilot contratadas';
COMMENT ON COLUMN public.org_subscriptions.base_amount       IS 'Valor bruto antes de descontos';
COMMENT ON COLUMN public.org_subscriptions.discount_amount   IS 'Total de desconto aplicado';
COMMENT ON COLUMN public.org_subscriptions.final_amount      IS 'Valor final cobrado (base - discount)';

CREATE INDEX IF NOT EXISTS idx_org_subscriptions_org
  ON public.org_subscriptions (organization_id);

CREATE INDEX IF NOT EXISTS idx_org_subscriptions_plan
  ON public.org_subscriptions (plan_id);

CREATE INDEX IF NOT EXISTS idx_org_subscriptions_renews
  ON public.org_subscriptions (renews_at)
  WHERE cancelled_at IS NULL;

-- RLS — org_subscriptions
ALTER TABLE public.org_subscriptions ENABLE ROW LEVEL SECURITY;

-- Membros da org podem ver a própria assinatura
CREATE POLICY "org_subscriptions_select_own"
  ON public.org_subscriptions FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    OR public.is_master_user()
  );

-- service_role (via Edge Functions) e masters gerenciam todas
CREATE POLICY "org_subscriptions_all_service_or_master"
  ON public.org_subscriptions FOR ALL
  USING (
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role'
    OR public.is_master_user()
  )
  WITH CHECK (
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role'
    OR public.is_master_user()
  );

-- ============================================
-- FASE 7: Tabela payment_history
-- ============================================

CREATE TABLE IF NOT EXISTS public.payment_history (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  asaas_payment_id      TEXT        UNIQUE,
  asaas_subscription_id TEXT,
  amount                NUMERIC     NOT NULL,
  discount_applied      NUMERIC     NOT NULL DEFAULT 0,
  coupon_id             UUID        REFERENCES public.coupons(id) ON DELETE SET NULL,
  billing_cycle         TEXT        NOT NULL CHECK (billing_cycle IN ('monthly', 'semester', 'annual')),
  status                TEXT        NOT NULL CHECK (status IN ('pending', 'confirmed', 'received', 'overdue', 'refunded', 'failed', 'cancelled')),
  paid_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.payment_history                        IS 'Histórico de pagamentos Asaas por organização';
COMMENT ON COLUMN public.payment_history.asaas_payment_id       IS 'ID do pagamento no Asaas (pay_xxx)';
COMMENT ON COLUMN public.payment_history.asaas_subscription_id  IS 'ID da subscription recorrente no Asaas (sub_xxx)';
COMMENT ON COLUMN public.payment_history.discount_applied        IS 'Desconto total aplicado neste pagamento';
COMMENT ON COLUMN public.payment_history.status                  IS 'Status refletindo webhook Asaas';

CREATE INDEX IF NOT EXISTS idx_payment_history_org
  ON public.payment_history (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_history_asaas_payment
  ON public.payment_history (asaas_payment_id);

CREATE INDEX IF NOT EXISTS idx_payment_history_status
  ON public.payment_history (status);

-- RLS — payment_history
ALTER TABLE public.payment_history ENABLE ROW LEVEL SECURITY;

-- Membros da org podem ver seu histórico
CREATE POLICY "payment_history_select_own"
  ON public.payment_history FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    OR public.is_master_user()
  );

-- service_role e masters gerenciam tudo
CREATE POLICY "payment_history_all_service_or_master"
  ON public.payment_history FOR ALL
  USING (
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role'
    OR public.is_master_user()
  )
  WITH CHECK (
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role'
    OR public.is_master_user()
  );

-- ============================================
-- FASE 8: RPC validate_coupon
-- ============================================

CREATE OR REPLACE FUNCTION public.validate_coupon(
  p_code      TEXT,
  p_plan_slug TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_coupon RECORD;
BEGIN
  -- Buscar cupom pelo código (case-insensitive)
  SELECT *
  INTO v_coupon
  FROM public.coupons
  WHERE UPPER(code) = UPPER(p_code);

  -- Não encontrado
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'valid',       false,
      'discount_pct', 0,
      'coupon_id',   NULL,
      'error',       'COUPON_NOT_FOUND'
    );
  END IF;

  -- Inativo
  IF NOT v_coupon.is_active THEN
    RETURN jsonb_build_object(
      'valid',       false,
      'discount_pct', 0,
      'coupon_id',   v_coupon.id,
      'error',       'COUPON_INACTIVE'
    );
  END IF;

  -- Antes de valid_from
  IF v_coupon.valid_from IS NOT NULL AND NOW() < v_coupon.valid_from THEN
    RETURN jsonb_build_object(
      'valid',       false,
      'discount_pct', 0,
      'coupon_id',   v_coupon.id,
      'error',       'COUPON_NOT_YET_VALID'
    );
  END IF;

  -- Expirado
  IF v_coupon.valid_until IS NOT NULL AND NOW() > v_coupon.valid_until THEN
    RETURN jsonb_build_object(
      'valid',       false,
      'discount_pct', 0,
      'coupon_id',   v_coupon.id,
      'error',       'COUPON_EXPIRED'
    );
  END IF;

  -- Limite de usos atingido
  IF v_coupon.max_uses IS NOT NULL AND v_coupon.current_uses >= v_coupon.max_uses THEN
    RETURN jsonb_build_object(
      'valid',       false,
      'discount_pct', 0,
      'coupon_id',   v_coupon.id,
      'error',       'COUPON_MAX_USES_REACHED'
    );
  END IF;

  -- Não se aplica ao plano (applies_to vazio = aplica a todos)
  IF array_length(v_coupon.applies_to, 1) > 0
    AND NOT (p_plan_slug = ANY(v_coupon.applies_to))
  THEN
    RETURN jsonb_build_object(
      'valid',       false,
      'discount_pct', 0,
      'coupon_id',   v_coupon.id,
      'error',       'COUPON_PLAN_NOT_ELIGIBLE'
    );
  END IF;

  -- Válido
  RETURN jsonb_build_object(
    'valid',       true,
    'discount_pct', v_coupon.discount_pct,
    'coupon_id',   v_coupon.id,
    'error',       NULL
  );
END;
$$;

COMMENT ON FUNCTION public.validate_coupon IS
  'Valida um cupom de desconto para um plano específico. '
  'Retorna {valid, discount_pct, coupon_id, error}. '
  'Erros: COUPON_NOT_FOUND | COUPON_INACTIVE | COUPON_NOT_YET_VALID | '
  'COUPON_EXPIRED | COUPON_MAX_USES_REACHED | COUPON_PLAN_NOT_ELIGIBLE';

-- Conceder execução para todos os roles relevantes
GRANT EXECUTE ON FUNCTION public.validate_coupon(TEXT, TEXT)
  TO authenticated, anon, service_role;

-- ============================================
-- FIM DA MIGRATION
-- ============================================
