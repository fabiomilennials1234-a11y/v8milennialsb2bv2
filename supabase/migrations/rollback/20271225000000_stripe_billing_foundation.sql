-- Rollback de 20271225000000_stripe_billing_foundation.sql
--
-- Só enquanto a Stripe estiver INERTE: as colunas e a tabela derrubadas aqui são a
-- única ligação entre uma assinatura viva na Stripe e a organização que paga. Com
-- assinatura real, parar de escrever é o caminho, não apagar.
--
-- Restaura billing_quote_price e billing_provision_existing_org com os corpos de prod
-- lidos em 04/11/2026. CREATE OR REPLACE preserva grants; os REVOKE/GRANT ficam por
-- extenso mesmo assim.

DROP FUNCTION IF EXISTS public.billing_stripe_attach_checkout(uuid, text, text, text, integer);
DROP FUNCTION IF EXISTS public.billing_stripe_record_consent(uuid, text);
DROP FUNCTION IF EXISTS public.billing_stripe_apply_invoice_paid(uuid, text, text, integer, text, timestamptz, timestamptz, timestamptz, text, text, boolean);
DROP FUNCTION IF EXISTS public.billing_stripe_apply_invoice_failed(uuid, text, text, integer, timestamptz, timestamptz, text);
DROP FUNCTION IF EXISTS public.billing_stripe_mirror_subscription(uuid, text, text, timestamptz, boolean, timestamptz);
DROP FUNCTION IF EXISTS public.billing_pending_provisionings(integer);

CREATE OR REPLACE FUNCTION public.billing_quote_price(
  p_plan_id            uuid,
  p_user_count         integer,
  p_billing_cycle      text,
  p_payment_method     text    DEFAULT NULL,
  p_coupon_code        text    DEFAULT NULL,
  p_manual_final_cents integer DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_plan            RECORD;
  v_seats           integer;
  v_extra_seats     integer;
  v_base_cents      integer;
  v_seat_cents      integer;
  v_subtotal_cents  integer;
  v_cycle_pct       numeric(5,2) := 0;
  v_cycle_disc      integer := 0;
  v_after_cycle     integer;
  v_coupon          jsonb;
  v_coupon_pct      numeric(5,2) := 0;
  v_coupon_id       uuid;
  v_coupon_disc     integer := 0;
  v_after_coupon    integer;
  v_manual_disc     integer := 0;
  v_final_cents     integer;
  v_cycle_months    integer;
BEGIN
  IF p_billing_cycle NOT IN ('monthly', 'semiannual', 'annual') THEN
    RAISE EXCEPTION 'billing_quote_price: ciclo invalido "%"', p_billing_cycle
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_payment_method IS NOT NULL AND p_payment_method NOT IN ('pix', 'credit_card') THEN
    RAISE EXCEPTION 'billing_quote_price: meio de pagamento invalido "%"', p_payment_method
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_payment_method = 'pix' AND p_billing_cycle = 'monthly' THEN
    RAISE EXCEPTION 'billing_quote_price: pix nao e vendido no ciclo mensal'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_plan FROM public.subscription_plans WHERE id = p_plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'billing_quote_price: plano % nao encontrado', p_plan_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF p_manual_final_cents IS NOT NULL AND p_manual_final_cents < 0 THEN
    RAISE EXCEPTION 'billing_quote_price: preco manual nao pode ser negativo'
      USING ERRCODE = 'check_violation';
  END IF;

  v_seats := GREATEST(COALESCE(p_user_count, 0), COALESCE(v_plan.min_users, 1));

  IF v_plan.price_per_user_monthly IS NOT NULL THEN
    v_base_cents := 0;
    v_seat_cents := ROUND(v_plan.price_per_user_monthly * 100)::integer * v_seats;
    v_extra_seats := v_seats;
  ELSE
    v_base_cents  := ROUND(COALESCE(v_plan.base_price_monthly, v_plan.price_monthly, 0) * 100)::integer;
    v_extra_seats := GREATEST(v_seats - COALESCE(v_plan.included_users, 0), 0);
    v_seat_cents  := ROUND(COALESCE(v_plan.extra_user_price, 0) * 100)::integer * v_extra_seats;
  END IF;

  v_subtotal_cents := v_base_cents + v_seat_cents;

  v_cycle_months := CASE p_billing_cycle
                      WHEN 'monthly'    THEN 1
                      WHEN 'semiannual' THEN 6
                      WHEN 'annual'     THEN 12
                    END;

  v_cycle_pct := CASE p_billing_cycle
                   WHEN 'semiannual' THEN COALESCE(v_plan.discount_semester_pct, 0)
                   WHEN 'annual'     THEN COALESCE(v_plan.discount_annual_pct, 0)
                   ELSE 0
                 END;

  v_cycle_disc  := ROUND(v_subtotal_cents * v_cycle_pct / 100.0)::integer;
  v_after_cycle := v_subtotal_cents - v_cycle_disc;

  IF p_coupon_code IS NOT NULL AND btrim(p_coupon_code) <> '' THEN
    v_coupon := public.validate_coupon(btrim(p_coupon_code), v_plan.name);
    IF COALESCE((v_coupon->>'valid')::boolean, false) THEN
      v_coupon_pct  := (v_coupon->>'discount_pct')::numeric;
      v_coupon_id   := NULLIF(v_coupon->>'coupon_id', '')::uuid;
      v_coupon_disc := ROUND(v_after_cycle * v_coupon_pct / 100.0)::integer;
    END IF;
  END IF;

  v_after_coupon := v_after_cycle - v_coupon_disc;

  IF p_manual_final_cents IS NOT NULL THEN
    v_final_cents := p_manual_final_cents;
    v_manual_disc := GREATEST(v_after_coupon - p_manual_final_cents, 0);
  ELSE
    v_final_cents := v_after_coupon;
  END IF;

  RETURN jsonb_build_object(
    'plan_id',              v_plan.id,
    'plan_name',            v_plan.name,
    'billing_cycle',        p_billing_cycle,
    'cycle_months',         v_cycle_months,
    'payment_method',       p_payment_method,
    'seats',                v_seats,
    'included_seats',       COALESCE(v_plan.included_users, 0),
    'extra_seats',          v_extra_seats,
    'base_cents',           v_base_cents,
    'seat_cents',           v_seat_cents,
    'subtotal_cents',       v_subtotal_cents,
    'cycle_discount_pct',   v_cycle_pct,
    'cycle_discount_cents', v_cycle_disc,
    'coupon_id',            v_coupon_id,
    'coupon_discount_pct',  v_coupon_pct,
    'coupon_discount_cents',v_coupon_disc,
    'manual_discount_cents',v_manual_disc,
    'monthly_cents',        v_final_cents,
    'charge_cents',         v_final_cents * v_cycle_months,
    'base_amount_cents',    v_subtotal_cents,
    'discount_amount_cents',v_subtotal_cents - v_final_cents,
    'final_amount_cents',   v_final_cents
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.billing_provision_existing_org(p_provider_payment_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sub   public.org_subscriptions%ROWTYPE;
  v_plan  text;
  v_meses integer;
  v_ate   timestamptz;
  v_role  text := coalesce(
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role'), '');
BEGIN
  IF v_role <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'access_denied: billing_provision_existing_org é só do serviço'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_sub
    FROM public.org_subscriptions
   WHERE provider_payment_id = p_provider_payment_id
     AND cancelled_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'subscription_not_found');
  END IF;

  SELECT sp.name INTO v_plan
    FROM public.subscription_plans sp
   WHERE sp.id = v_sub.plan_id;

  IF v_plan IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'plan_not_found');
  END IF;

  v_meses := CASE v_sub.billing_cycle
               WHEN 'monthly'    THEN 1
               WHEN 'semiannual' THEN 6
               WHEN 'annual'     THEN 12
               ELSE 1
             END;

  v_ate := greatest(
             coalesce((SELECT subscription_expires_at FROM public.organizations
                        WHERE id = v_sub.organization_id), now()),
             now()
           ) + make_interval(months => v_meses);

  UPDATE public.organizations
     SET subscription_status     = 'active',
         subscription_plan       = v_plan,
         subscription_expires_at = v_ate,
         updated_at              = now()
   WHERE id = v_sub.organization_id;

  INSERT INTO public.subscription_provisionings
    (organization_id, provider_payment_id, target_kind, plan_name, activated_until)
  VALUES
    (v_sub.organization_id, p_provider_payment_id, 'existing_org', v_plan, v_ate)
  ON CONFLICT (provider_payment_id) DO NOTHING;

  RETURN jsonb_build_object(
    'ok', true,
    'code', 'provisioned',
    'organization_id', v_sub.organization_id,
    'plan', v_plan,
    'active_until', v_ate);
END;
$function$;

REVOKE ALL ON FUNCTION public.billing_provision_existing_org(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_provision_existing_org(text) TO service_role;

DROP FUNCTION IF EXISTS public.billing_stripe_assert_service();

DROP INDEX IF EXISTS public.org_subscriptions_provider_subscription_key;
ALTER TABLE public.org_subscriptions
  DROP COLUMN IF EXISTS provider_status,
  DROP COLUMN IF EXISTS cancel_at_period_end;

ALTER TABLE public.payment_history
  DROP CONSTRAINT IF EXISTS payment_history_provider_payment_key;
ALTER TABLE public.payment_history
  DROP COLUMN IF EXISTS provider,
  DROP COLUMN IF EXISTS provider_payment_id;

DROP INDEX IF EXISTS public.payment_link_charges_provider_subscription_key;
ALTER TABLE public.payment_link_charges
  DROP COLUMN IF EXISTS provider_subscription_id,
  DROP COLUMN IF EXISTS provider_customer_id,
  DROP COLUMN IF EXISTS attempt;

ALTER TABLE public.payment_link_buyers
  DROP CONSTRAINT IF EXISTS payment_link_buyers_recurring_consent_coerente_check;
ALTER TABLE public.payment_link_buyers
  DROP COLUMN IF EXISTS recurring_consent_version,
  DROP COLUMN IF EXISTS recurring_consent_at;

DROP TABLE IF EXISTS public.org_billing_customers;
