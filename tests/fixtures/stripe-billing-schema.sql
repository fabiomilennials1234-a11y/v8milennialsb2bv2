-- Subconjunto de prod (lido com SELECT em 04/11/2026) para provar a migration da Stripe
-- em PGlite, sem Docker e sem prod. As migrations de billing rodam de verdade por cima
-- deste chão: ver tests/helpers/stripe-billing-pglite.mjs. Sem dado real.

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE SCHEMA cron;
CREATE EXTENSION pgcrypto SCHEMA extensions;

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;

-- O que o Supabase instala em prod: é isto que torna explícito o REVOKE por papel.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;

CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command) RETURNING jobid::bigint
$$;
CREATE FUNCTION cron.unschedule(p_name text) RETURNS boolean LANGUAGE sql AS $$
  DELETE FROM cron.job WHERE jobname = p_name RETURNING true
$$;

CREATE TABLE public.cron_config (key text PRIMARY KEY, value text);

CREATE TABLE public.master_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.master_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_user_id uuid, user_id uuid, action text, target_type text, target_id uuid,
  target_name text, details jsonb
);
CREATE FUNCTION public.is_master_user() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.master_users WHERE user_id = auth.uid() AND is_active)
$$;

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  subscription_status text NOT NULL DEFAULT 'trial',
  subscription_plan text,
  subscription_expires_at timestamptz,
  limit_overrides jsonb DEFAULT '{}'::jsonb,
  is_sandbox boolean NOT NULL DEFAULT false,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  display_name text NOT NULL,
  price_monthly numeric DEFAULT 0,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true,
  price_per_user_monthly numeric,
  base_price_monthly numeric,
  min_users integer DEFAULT 1,
  included_users integer DEFAULT 0,
  extra_user_price numeric DEFAULT 0,
  discount_semester_pct numeric DEFAULT 10,
  discount_annual_pct numeric DEFAULT 15
);

-- Valores de prod em 04/11/2026.
INSERT INTO public.subscription_plans
  (name, display_name, price_monthly, price_per_user_monthly, base_price_monthly, min_users, included_users, extra_user_price, features, limits)
VALUES
  ('torque-1.0', 'Base', 594, 297, NULL, 2, 0, 297,
   '{"chat":false,"deals":true,"leads":true,"review":true,"copilot":false,"funnels":true,"oraculo":false,"carteira":true,"products":true,"analytics":true,"marketing":true,"automations":false,"commissions":true,"performance":true,"voice_calls":false,"tv_dashboard":true,"whatsapp_bulk":false,"message_templates":false,"customer_portfolio":true,"scheduled_messages":false}',
   '{"max_leads":-1,"max_users":5,"max_funnels":-1,"max_campaigns":-1,"max_copilot_agents":0,"max_whatsapp_instances":0,"max_documents_per_agent":0}'),
  ('torque-2.0', 'Automation', 3485, 697, NULL, 5, 0, 697,
   '{"chat":true,"deals":true,"leads":true,"review":true,"copilot":false,"funnels":true,"oraculo":false,"carteira":true,"products":true,"analytics":true,"marketing":true,"automations":true,"commissions":true,"performance":true,"voice_calls":false,"tv_dashboard":true,"whatsapp_bulk":true,"message_templates":true,"customer_portfolio":true,"scheduled_messages":true}',
   '{"max_leads":-1,"max_users":5,"max_funnels":-1,"max_campaigns":-1,"max_copilot_agents":0,"max_whatsapp_instances":-1,"max_documents_per_agent":0}'),
  ('torque-v8', 'Copilot', 1997, NULL, 1997, 3, 3, 120,
   '{"chat":true,"deals":true,"leads":true,"review":true,"copilot":true,"funnels":true,"oraculo":true,"carteira":true,"products":true,"analytics":true,"marketing":true,"automations":true,"commissions":true,"performance":true,"voice_calls":false,"tv_dashboard":true,"whatsapp_bulk":true,"message_templates":true,"customer_portfolio":true,"scheduled_messages":true}',
   '{"max_leads":-1,"max_users":5,"max_funnels":-1,"max_campaigns":-1,"max_copilot_agents":-1,"max_whatsapp_instances":-1,"max_documents_per_agent":-1}'),
  ('enterprise', 'Enterprise', 497, NULL, NULL, 1, 0, 0, '{}',
   '{"max_users":-1,"max_copilot_agents":-1,"max_whatsapp_instances":-1}');

CREATE TABLE public.feature_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  default_enabled boolean DEFAULT false,
  is_sellable boolean NOT NULL DEFAULT false
);
INSERT INTO public.feature_catalog (key, is_sellable, default_enabled) VALUES
 ('analytics',true,true),('api_access',true,false),('automations',true,true),('campaigns_auto',true,false),
 ('campaigns_manual',true,true),('campaigns_semi',true,false),('carteira',true,true),('chat',true,true),
 ('commissions',true,true),('copilot',true,false),('copilot_advanced',true,false),('customer_portfolio',true,false),
 ('external_cadastro',true,false),('funnels',true,true),('funnels_custom',true,false),('funnels_template_indicacao',true,false),
 ('funnels_template_prospeccao',true,false),('funnels_template_reativacao',true,false),('marketing',true,false),
 ('merged_opportunity_funnel',false,false),('message_templates',true,false),('oraculo',true,true),('performance',true,true),
 ('portfolio_alerts_whatsapp',false,false),('products',true,true),('review',true,true),('scheduled_messages',true,true),
 ('tv_dashboard',true,true),('unified_message_gateway',false,false),('user_write_instance_strict',false,false),
 ('voice_calls',true,false),('whatsapp_bulk',true,false),('white_label',true,false),('leads',true,true),('deals',true,false);

CREATE TABLE public.organization_features (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  enabled boolean NOT NULL,
  expires_at timestamptz
);

CREATE TABLE public.org_quotas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  resource_key text NOT NULL,
  plan_base integer NOT NULL DEFAULT 0,
  purchased_addons integer NOT NULL DEFAULT 0,
  admin_adjustment integer NOT NULL DEFAULT 0,
  effective_limit integer GENERATED ALWAYS AS (
    CASE WHEN plan_base = -1 THEN -1 ELSE GREATEST(plan_base + purchased_addons + admin_adjustment, 0) END
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_quotas_org_resource_unique UNIQUE (organization_id, resource_key)
);

-- Corpo de prod.
CREATE FUNCTION public.sync_org_plan_quotas() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_limits JSONB;
  v_resource TEXT;
  v_raw JSONB;
BEGIN
  IF NEW.subscription_plan IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT sp.limits INTO v_limits FROM public.subscription_plans sp WHERE sp.name = NEW.subscription_plan;
  IF v_limits IS NULL THEN
    RETURN NEW;
  END IF;
  FOREACH v_resource IN ARRAY ARRAY['max_whatsapp_instances', 'max_copilot_agents', 'max_users'] LOOP
    v_raw := v_limits -> v_resource;
    IF v_raw IS NULL OR jsonb_typeof(v_raw) = 'null' THEN
      CONTINUE;
    END IF;
    INSERT INTO public.org_quotas (organization_id, resource_key, plan_base)
    VALUES (NEW.id, v_resource, (v_limits->>v_resource)::INTEGER)
    ON CONFLICT (organization_id, resource_key) DO UPDATE
    SET plan_base = EXCLUDED.plan_base, updated_at = NOW();
  END LOOP;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_sync_org_plan_quotas AFTER INSERT OR UPDATE OF subscription_plan ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.sync_org_plan_quotas();

-- O gatilho de reativação de prod (mesmo WHEN), com corpo reduzido: o que importa é a
-- suspensa voltar a ativa sem quebrar a provisão.
CREATE TABLE public.oraculo_benchmark_weekly (
  organization_id uuid NOT NULL, snapshot_week date NOT NULL,
  PRIMARY KEY (organization_id, snapshot_week)
);
CREATE FUNCTION public.initialize_oraculo_benchmark_snapshot() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
BEGIN
  INSERT INTO public.oraculo_benchmark_weekly (organization_id, snapshot_week)
  VALUES (NEW.id, date_trunc('week', (clock_timestamp() AT TIME ZONE NEW.timezone)::date)::date)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_initialize_oraculo_benchmark_on_reactivation
  AFTER UPDATE OF is_sandbox, subscription_status ON public.organizations FOR EACH ROW
  WHEN (((old.is_sandbox OR (old.subscription_status = ANY (ARRAY['suspended'::text, 'cancelled'::text, 'expired'::text]))) AND (NOT new.is_sandbox) AND (new.subscription_status = ANY (ARRAY['active'::text, 'trial'::text, 'overdue'::text]))))
  EXECUTE FUNCTION public.initialize_oraculo_benchmark_snapshot();

CREATE TABLE public.coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE,
  discount_pct numeric,
  current_uses integer DEFAULT 0
);
CREATE FUNCTION public.validate_coupon(p_code text, p_plan text) RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object('valid', true, 'discount_pct', discount_pct, 'coupon_id', id) FROM public.coupons WHERE code = p_code),
    '{"valid": false}'::jsonb)
$$;
CREATE FUNCTION public.increment_coupon_uses(p_id uuid) RETURNS void LANGUAGE sql AS $$
  UPDATE public.coupons SET current_uses = current_uses + 1 WHERE id = p_id
$$;

CREATE TABLE public.org_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.subscription_plans(id),
  billing_cycle text NOT NULL CHECK (billing_cycle IN ('monthly','semiannual','annual')),
  user_count integer NOT NULL DEFAULT 1 CHECK (user_count >= 1),
  coupon_id uuid REFERENCES public.coupons(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  renews_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  base_amount_cents integer NOT NULL DEFAULT 0,
  discount_amount_cents integer NOT NULL DEFAULT 0,
  final_amount_cents integer NOT NULL DEFAULT 0,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  payment_method text CHECK (payment_method IS NULL OR payment_method IN ('pix','credit_card')),
  cycle_discount_pct numeric NOT NULL DEFAULT 0,
  coupon_discount_pct numeric NOT NULL DEFAULT 0,
  manual_discount_cents integer NOT NULL DEFAULT 0,
  manual_discount_reason text,
  manual_discount_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  provider text,
  provider_subscription_id text,
  CONSTRAINT org_subscriptions_amounts_sane CHECK (base_amount_cents >= 0 AND discount_amount_cents >= 0 AND final_amount_cents >= 0 AND final_amount_cents <= base_amount_cents),
  CONSTRAINT org_subscriptions_manual_discount_needs_reason CHECK (manual_discount_cents = 0 OR NULLIF(btrim(COALESCE(manual_discount_reason, '')), '') IS NOT NULL)
);
CREATE UNIQUE INDEX org_subscriptions_one_current_per_org ON public.org_subscriptions (organization_id) WHERE cancelled_at IS NULL;

CREATE TABLE public.payment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  asaas_payment_id text UNIQUE,
  asaas_subscription_id text,
  amount numeric NOT NULL CHECK (amount >= 0),
  discount_applied numeric NOT NULL DEFAULT 0,
  coupon_id uuid REFERENCES public.coupons(id) ON DELETE SET NULL,
  billing_cycle text NOT NULL CHECK (billing_cycle IN ('monthly','semiannual','annual')),
  status text NOT NULL CHECK (status IN ('pending','confirmed','received','overdue','refunded','failed','cancelled')),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  invoice_url text,
  receipt_url text,
  period_start date,
  period_end date,
  billing_type text CHECK (billing_type IS NULL OR billing_type IN ('PIX','CREDIT_CARD','DEBIT_CARD','BOLETO','TRANSFER','DEPOSIT','UNDEFINED')),
  CHECK (period_start IS NULL OR period_end IS NULL OR period_end >= period_start)
);

-- Corpo de prod, salvo os ramos de Master, que aqui não importam para o snapshot.
CREATE FUNCTION public.org_get_features_and_limits(p_org_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $function$
DECLARE
  v_features    JSONB := '{}';
  v_limits      JSONB := '{}';
  v_org         RECORD;
  v_snapshot    RECORD;
  v_override    RECORD;
  v_flag        RECORD;
  v_quota_row   RECORD;
  v_plan_name   TEXT;
  v_quota_keys  TEXT[] := ARRAY['max_whatsapp_instances', 'max_users', 'max_copilot_agents'];
BEGIN
  SELECT os.features, os.limits, sp.name AS plan_name INTO v_snapshot
    FROM public.org_subscriptions os
    LEFT JOIN public.subscription_plans sp ON sp.id = os.plan_id
   WHERE os.organization_id = p_org_id AND os.cancelled_at IS NULL;
  IF FOUND THEN
    v_features  := COALESCE(v_snapshot.features, '{}'::jsonb);
    v_limits    := COALESCE(v_snapshot.limits, '{}'::jsonb);
    v_plan_name := v_snapshot.plan_name;
  ELSE
    SELECT o.subscription_plan, COALESCE(sp.features, '{}') AS plan_features, COALESCE(sp.limits, '{}') AS plan_limits INTO v_org
      FROM public.organizations o LEFT JOIN public.subscription_plans sp ON sp.name = o.subscription_plan
     WHERE o.id = p_org_id;
    v_features  := COALESCE(v_org.plan_features, '{}');
    v_limits    := COALESCE(v_org.plan_limits, '{}');
    v_plan_name := v_org.subscription_plan;
  END IF;
  FOR v_override IN SELECT feature_key, enabled FROM public.organization_features WHERE organization_id = p_org_id AND (expires_at IS NULL OR expires_at > NOW()) LOOP
    v_features := v_features || jsonb_build_object(v_override.feature_key, v_override.enabled);
  END LOOP;
  FOR v_flag IN SELECT key, default_enabled FROM public.feature_catalog WHERE NOT (v_features ? key) LOOP
    v_features := v_features || jsonb_build_object(v_flag.key, v_flag.default_enabled);
  END LOOP;
  SELECT o.limit_overrides INTO v_org FROM public.organizations o WHERE o.id = p_org_id;
  IF v_org.limit_overrides IS NOT NULL AND v_org.limit_overrides != '{}'::JSONB THEN
    v_limits := v_limits || v_org.limit_overrides;
  END IF;
  FOR v_quota_row IN SELECT oq.resource_key, oq.effective_limit FROM public.org_quotas oq WHERE oq.organization_id = p_org_id AND oq.resource_key = ANY(v_quota_keys) LOOP
    v_limits := v_limits || jsonb_build_object(v_quota_row.resource_key, v_quota_row.effective_limit);
  END LOOP;
  RETURN jsonb_build_object('features', v_features, 'limits', v_limits, 'plan_name', COALESCE(v_plan_name, 'free'));
END;
$function$;
