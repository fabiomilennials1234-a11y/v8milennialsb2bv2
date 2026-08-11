-- 20270806000001_billing_price_engine.sql
--
-- Fatia 4 do PRD #1393. Implementa as decisões de #1381.
--
-- O motor de preço vive no Postgres, e não no frontend nem numa edge function, por três
-- razões: nasce atômico com a escrita do link e do snapshot; nenhum caminho vindo do browser
-- alcança o cálculo; e é testável por pgTAP, que é o seam mais alto para regra de dinheiro.
--
-- `EXECUTE` é concedido APENAS a `service_role`. Quem chama é a edge function que cria o
-- link, e é ela que autoriza (é master? pode vender para essa org?). Autorização separada de
-- execução — a função calcula, não decide quem pode.

-- ---------------------------------------------------------------------------
-- billing_quote_price
-- ---------------------------------------------------------------------------
--
-- Cascata multiplicativa, na ordem fixada em #1381:
--
--   1. preço base do plano, pela forma do plano
--   2. assentos acima do incluído × preço do extra, respeitando min_users
--   3. desconto de ciclo, sobre o subtotal
--   4. cupom, sobre o que sobrou do passo 3
--   5. override manual do Master, se houver
--
-- Cada desconto aplica sobre o resultado do anterior. Nunca chega a zero por construção:
-- dois cupons de 50% dão 75%, não 100%. Aditivo foi rejeitado por não ter piso.
--
-- Os planos ativos têm DUAS formas de preço, e a função cobre as duas:
--   price_per_user_monthly preenchido → puro por assento (torque-1.0, torque-2.0)
--   base_price_monthly preenchido     → base + extras   (torque-v8)
--
-- Dinheiro em centavos inteiros ponta a ponta, arredondando a centavo a cada etapa, para que
-- o valor exibido e o cobrado sejam o mesmo número.

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
  -- ── Entradas ─────────────────────────────────────────────────────────────
  IF p_billing_cycle NOT IN ('monthly', 'semiannual', 'annual') THEN
    RAISE EXCEPTION 'billing_quote_price: ciclo inválido "%"', p_billing_cycle
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_payment_method IS NOT NULL AND p_payment_method NOT IN ('pix', 'credit_card') THEN
    RAISE EXCEPTION 'billing_quote_price: meio de pagamento inválido "%"', p_payment_method
      USING ERRCODE = 'check_violation';
  END IF;

  -- Pix não tem recorrência automática, então não se vende Pix mensal. Recusa ANTES de
  -- calcular: um valor devolvido para uma combinação impossível vira proposta enviada.
  IF p_payment_method = 'pix' AND p_billing_cycle = 'monthly' THEN
    RAISE EXCEPTION 'billing_quote_price: pix não é vendido no ciclo mensal'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_plan FROM public.subscription_plans WHERE id = p_plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'billing_quote_price: plano % não encontrado', p_plan_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF p_manual_final_cents IS NOT NULL AND p_manual_final_cents < 0 THEN
    RAISE EXCEPTION 'billing_quote_price: preço manual não pode ser negativo'
      USING ERRCODE = 'check_violation';
  END IF;

  -- ── 1 e 2: base e assentos ───────────────────────────────────────────────
  v_seats := GREATEST(COALESCE(p_user_count, 0), COALESCE(v_plan.min_users, 1));

  IF v_plan.price_per_user_monthly IS NOT NULL THEN
    -- Puro por assento: todo assento custa o mesmo, não há base separada.
    v_base_cents := 0;
    v_seat_cents := ROUND(v_plan.price_per_user_monthly * 100)::integer * v_seats;
    v_extra_seats := v_seats;
  ELSE
    -- Base com assentos inclusos, extras cobrados à parte.
    v_base_cents  := ROUND(COALESCE(v_plan.base_price_monthly, v_plan.price_monthly, 0) * 100)::integer;
    v_extra_seats := GREATEST(v_seats - COALESCE(v_plan.included_users, 0), 0);
    v_seat_cents  := ROUND(COALESCE(v_plan.extra_user_price, 0) * 100)::integer * v_extra_seats;
  END IF;

  v_subtotal_cents := v_base_cents + v_seat_cents;

  -- ── 3: desconto de ciclo ─────────────────────────────────────────────────
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

  -- ── 4: cupom, sobre o que sobrou ─────────────────────────────────────────
  IF p_coupon_code IS NOT NULL AND btrim(p_coupon_code) <> '' THEN
    v_coupon := public.validate_coupon(btrim(p_coupon_code), v_plan.name);
    IF COALESCE((v_coupon->>'valid')::boolean, false) THEN
      v_coupon_pct  := (v_coupon->>'discount_pct')::numeric;
      v_coupon_id   := NULLIF(v_coupon->>'coupon_id', '')::uuid;
      v_coupon_disc := ROUND(v_after_cycle * v_coupon_pct / 100.0)::integer;
    END IF;
  END IF;

  v_after_coupon := v_after_cycle - v_coupon_disc;

  -- ── 5: override manual ───────────────────────────────────────────────────
  -- Sem teto por decisão de #1381: o controle é registro, não trava. O motivo obrigatório é
  -- invariante da tabela (org_subscriptions_manual_discount_needs_reason), não daqui — esta
  -- função calcula e não persiste.
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
    -- Mensal já com todos os descontos. É o número que a UI mostra como "por mês".
    'monthly_cents',        v_final_cents,
    -- O que o gateway cobra de fato neste ciclo.
    'charge_cents',         v_final_cents * v_cycle_months,
    -- Espelham as colunas do snapshot, para que gravar seja cópia direta e não recálculo.
    'base_amount_cents',    v_subtotal_cents,
    'discount_amount_cents',v_subtotal_cents - v_final_cents,
    'final_amount_cents',   v_final_cents
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
--
-- CREATE OR REPLACE preserva grants de uma versão anterior, mas DROP + CREATE devolveria o
-- EXECUTE a PUBLIC. O REVOKE explícito abaixo é o que garante o fecho em qualquer um dos
-- dois caminhos — nenhum usuário autenticado calcula o próprio preço.

REVOKE ALL ON FUNCTION public.billing_quote_price(uuid, integer, text, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.billing_quote_price(uuid, integer, text, text, text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.billing_quote_price(uuid, integer, text, text, text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.billing_quote_price(uuid, integer, text, text, text, integer) TO service_role;

COMMENT ON FUNCTION public.billing_quote_price(uuid, integer, text, text, text, integer) IS
  'Motor de preço do checkout (#1381). Cascata multiplicativa: base+assentos → ciclo → cupom → override manual. Centavos inteiros. EXECUTE apenas service_role: a edge function do link é quem autoriza.';
