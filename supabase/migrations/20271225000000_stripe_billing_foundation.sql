-- 20271225000000_stripe_billing_foundation.sql
--
-- Stripe como gateway único (decisão do CTO, 04/11/2026; ADR em docs/adr).
-- NÚMERO PROVISÓRIO: renumerar ao aplicar (colisão de ledger é o normal aqui).
-- ROLLBACK pareado: rollback/20271225000000_stripe_billing_foundation.sql
--
-- Medido em prod em 04/11: 0 linhas em payment_links, payment_link_charges,
-- payment_webhook_events, org_subscriptions e payment_history. Por isso nada aqui
-- precisa de backfill, e os índices únicos nascem sem risco de dado.
--
-- Colunas `asaas_*` e `asaas-webhook` continuam intactas: a função está deployada e
-- renomear agora a quebraria. O id de invoice da Stripe NÃO vai para
-- `asaas_payment_id`, porque o nome mentiria.
--
-- Quatro defeitos herdados que esta migration fecha:
--   1. Snapshot vazio rebaixava quem paga: `org_get_features_and_limits` usa a
--      assinatura como base e `billing_apply_paid_subscription` não grava features
--      nem limits. A primeira invoice agora grava o snapshot.
--   2. `billing_provision_existing_org` somava validade a cada execução, porque
--      fazia UPDATE antes do INSERT no livro. Agora o livro vem primeiro.
--   3. #1564: assento pago não virava quota. A provisão grava `purchased_addons`.
--   4. #1559: override manual maior que o preço virava cobrança maior, em silêncio.
--
-- Todas as RPCs novas são SECURITY DEFINER com gate no corpo, além do grant:
-- `DROP + CREATE` devolve EXECUTE a PUBLIC, e isso já aconteceu neste repositório.
-- Nenhuma mensagem de exceção interpola e-mail, documento ou token.

-- ---------------------------------------------------------------------------
-- 1. Customer da Stripe, por organização
--
-- Fora do alcance de usuário: o id do Customer é o que basta para operar a conta na
-- Stripe, e `organizations` é lida por membros. RLS ligada sem policy e grants
-- mínimos: nem service_role altera ou apaga, porque o ponteiro é imutável.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.org_billing_customers (
  organization_id      uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider             text        NOT NULL,
  provider_customer_id text        NOT NULL UNIQUE,
  livemode             boolean     NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.org_billing_customers IS
  'Customer do gateway por organização. Sem policy e sem grant para anon/authenticated: id exposto a membro é credencial de operação na Stripe. Cartão NÃO é guardado aqui nem em lugar nenhum nosso.';

ALTER TABLE public.org_billing_customers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.org_billing_customers FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.org_billing_customers TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Expansões de tabelas existentes (todas vazias em prod)
-- ---------------------------------------------------------------------------
ALTER TABLE public.payment_link_charges
  ADD COLUMN IF NOT EXISTS provider_subscription_id text,
  ADD COLUMN IF NOT EXISTS provider_customer_id     text,
  ADD COLUMN IF NOT EXISTS attempt                  integer NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS payment_link_charges_provider_subscription_key
  ON public.payment_link_charges (provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

COMMENT ON COLUMN public.payment_link_charges.attempt IS
  'Tentativa de assinatura do link. Assinatura incomplete expira em 23 h: a próxima tentativa sobe este número e troca a linha, porque a chave de idempotência da Stripe inclui o attempt.';

ALTER TABLE public.payment_history
  ADD COLUMN IF NOT EXISTS provider            text,
  ADD COLUMN IF NOT EXISTS provider_payment_id text;

ALTER TABLE public.payment_history
  DROP CONSTRAINT IF EXISTS payment_history_provider_payment_key;
ALTER TABLE public.payment_history
  ADD CONSTRAINT payment_history_provider_payment_key UNIQUE (provider, provider_payment_id);

ALTER TABLE public.org_subscriptions
  ADD COLUMN IF NOT EXISTS provider_status      text,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS org_subscriptions_provider_subscription_key
  ON public.org_subscriptions (provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

-- Consentimento de recorrência: prova do aceite do comprador. Mora aqui, fora do
-- alcance do PostgREST, e só billing_stripe_record_consent escreve.
ALTER TABLE public.payment_link_buyers
  ADD COLUMN IF NOT EXISTS recurring_consent_version text,
  ADD COLUMN IF NOT EXISTS recurring_consent_at      timestamptz;

ALTER TABLE public.payment_link_buyers
  DROP CONSTRAINT IF EXISTS payment_link_buyers_recurring_consent_coerente_check;
ALTER TABLE public.payment_link_buyers
  ADD CONSTRAINT payment_link_buyers_recurring_consent_coerente_check CHECK (
    (recurring_consent_version IS NULL) = (recurring_consent_at IS NULL)
  );

COMMENT ON COLUMN public.payment_link_buyers.recurring_consent_version IS
  'Versão do texto de cobrança recorrente que o comprador aceitou no checkout. Definida no servidor (RECURRING_CONSENT_VERSION).';
COMMENT ON COLUMN public.payment_link_buyers.recurring_consent_at IS
  'Quando aquela versão foi aceita pela primeira vez. Repetir o aceite da mesma versão não move a data.';

-- ---------------------------------------------------------------------------
-- 3. #1559: override manual maior que o preço sem override
--
-- O parâmetro é o preço MENSAL. Quem manda o total do ciclo não ganha desconto:
-- ganha cobrança multiplicada, sem erro. Corpo idêntico ao de prod, mais a guarda.
-- CREATE OR REPLACE preserva os grants.
-- ---------------------------------------------------------------------------
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
    -- #1559. 22023, nunca 40001: 40001 faz o PostgREST repetir para sempre.
    IF p_manual_final_cents > v_after_coupon THEN
      RAISE EXCEPTION 'billing_quote_price: preco manual acima do preco sem override; o valor e mensal'
        USING ERRCODE = '22023';
    END IF;
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

-- ---------------------------------------------------------------------------
-- 4. Gate compartilhado do corpo das RPCs
--
-- `NULLIF` porque `current_setting(..., true)` devolve '' depois de um SET LOCAL
-- desfeito, e ''::jsonb levanta. session_user cobre o apply manual e o teste; o
-- PostgREST conecta como authenticator, então não passa por esse ramo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.billing_stripe_assert_service()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $fn$
BEGIN
  IF COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') <> 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'access_denied: billing stripe e so do servico' USING ERRCODE = '42501';
  END IF;
END
$fn$;

-- ---------------------------------------------------------------------------
-- 5. A assinatura criada na Stripe fica amarrada ao link ANTES do client_secret sair
--
-- Escrituração, não portão: a assinatura já existe do lado de fora. Link revogado ou
-- pago grava e sinaliza (`must_cancel`), porque recusar orfanaria o objeto e a
-- próxima tentativa não acharia nada. Regra de `billing_attach_link_charge`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.billing_stripe_attach_checkout(
  p_link_id         uuid,
  p_subscription_id text,
  p_invoice_id      text,
  p_customer_id     text,
  p_attempt         integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_link      public.payment_links%ROWTYPE;
  v_id        uuid;
  v_anterior  text;
  v_paga_esta boolean;
BEGIN
  PERFORM public.billing_stripe_assert_service();

  -- FOR UPDATE: serializa com a revogação e com o carimbo de pago.
  SELECT * INTO v_link FROM public.payment_links WHERE id = p_link_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'link_not_found');
  END IF;

  SELECT provider_subscription_id INTO v_anterior
    FROM public.payment_link_charges
   WHERE payment_link_id = p_link_id AND method = 'credit_card';

  -- Link pago por ESTA assinatura: é a que recebeu o dinheiro, e cancelar seria cortar
  -- quem pagou. Vale mesmo com o link revogado depois.
  v_paga_esta := v_link.paid_at IS NOT NULL AND v_anterior IS NOT DISTINCT FROM p_subscription_id;

  INSERT INTO public.payment_link_charges AS c
    (payment_link_id, method, provider, provider_charge_id,
     provider_subscription_id, provider_customer_id, attempt)
  VALUES
    (p_link_id, 'credit_card', 'stripe', p_invoice_id, p_subscription_id, p_customer_id, p_attempt)
  ON CONFLICT ON CONSTRAINT payment_link_charges_um_por_metodo DO UPDATE
     SET provider                 = 'stripe',
         provider_charge_id       = EXCLUDED.provider_charge_id,
         provider_subscription_id = EXCLUDED.provider_subscription_id,
         provider_customer_id     = EXCLUDED.provider_customer_id,
         attempt                  = EXCLUDED.attempt
   WHERE c.attempt <= EXCLUDED.attempt
  RETURNING c.id INTO v_id;

  RETURN jsonb_build_object(
    'ok',          true,
    'code',        CASE WHEN v_id IS NULL THEN 'stale_attempt' ELSE 'ok' END,
    'must_cancel', NOT v_paga_esta
                   AND (v_id IS NULL OR v_link.revoked_at IS NOT NULL OR v_link.paid_at IS NOT NULL),
    'reason',      CASE WHEN v_paga_esta                   THEN 'already_paid'
                        WHEN v_link.revoked_at IS NOT NULL THEN 'link_revoked'
                        WHEN v_link.paid_at    IS NOT NULL THEN 'already_paid'
                        WHEN v_id IS NULL                  THEN 'stale_attempt' END);
END
$fn$;

-- ---------------------------------------------------------------------------
-- 5-b. Aceite da cobrança recorrente
--
-- Chamada no passo 4 do checkout, antes de qualquer objeto na Stripe. Sem comprador
-- gravado não há onde guardar a prova: devolve código e o checkout para.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.billing_stripe_record_consent(
  p_link_id uuid,
  p_version text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  PERFORM public.billing_stripe_assert_service();

  IF NULLIF(btrim(COALESCE(p_version, '')), '') IS NULL THEN
    RAISE EXCEPTION 'versao de consentimento vazia (link %)', p_link_id USING ERRCODE = '22023';
  END IF;

  UPDATE public.payment_link_buyers
     SET recurring_consent_at = CASE WHEN recurring_consent_version IS NOT DISTINCT FROM p_version
                                     THEN recurring_consent_at ELSE now() END,
         recurring_consent_version = p_version,
         updated_at = now()
   WHERE payment_link_id = p_link_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'buyer_missing');
  END IF;

  RETURN jsonb_build_object('ok', true, 'code', 'ok');
END
$fn$;

-- ---------------------------------------------------------------------------
-- 6. invoice.paid
--
-- Uma transação. O ledger entra primeiro (FOR UPDATE) e é o que torna reentrega e
-- crash inofensivos: ou tudo isto aconteceu e o evento está `applied`, ou nada.
-- Falha real levanta e o handler responde 500, e a Stripe reentrega.
--
-- `p_status` é o estado ATUAL da assinatura, recuperado da Stripe. Só `active` mexe
-- em org_subscriptions; outro estado registra o dinheiro e devolve `not_active`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.billing_stripe_apply_invoice_paid(
  p_event_row_id         uuid,
  p_invoice_id           text,
  p_subscription_id      text,
  p_amount_paid_cents    integer,
  p_currency             text,
  p_period_start         timestamptz,
  p_period_end           timestamptz,
  p_paid_at              timestamptz,
  p_billing_reason       text,
  p_status               text,
  p_cancel_at_period_end boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_event   public.payment_webhook_events%ROWTYPE;
  v_charge  public.payment_link_charges%ROWTYPE;
  v_link    public.payment_links%ROWTYPE;
  v_cur     public.org_subscriptions%ROWTYPE;
  v_plan    public.subscription_plans%ROWTYPE;
  v_quote   jsonb;
  v_org     uuid;
  v_coupon  uuid;
  v_months  integer;
  v_features jsonb;
  v_conflict boolean := false;
  v_paid_at timestamptz := COALESCE(p_paid_at, now());
  v_code    text;
BEGIN
  PERFORM public.billing_stripe_assert_service();

  SELECT * INTO v_event FROM public.payment_webhook_events WHERE id = p_event_row_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'evento % ausente do ledger', p_event_row_id USING ERRCODE = 'P0002';
  END IF;
  IF v_event.status = 'applied' THEN
    RETURN jsonb_build_object('ok', true, 'code', 'already_applied');
  END IF;

  SELECT * INTO v_charge
    FROM public.payment_link_charges
   WHERE provider_subscription_id = p_subscription_id;

  IF NOT FOUND THEN
    UPDATE public.payment_webhook_events
       SET status = 'failed', error_message = 'subscription_unknown', processed_at = now()
     WHERE id = p_event_row_id;
    RETURN jsonb_build_object('ok', false, 'code', 'subscription_unknown');
  END IF;

  SELECT * INTO v_link FROM public.payment_links WHERE id = v_charge.payment_link_id FOR UPDATE;
  v_org    := v_link.organization_id;
  v_quote  := v_link.quote;
  v_months := COALESCE((v_quote ->> 'cycle_months')::integer, 1);
  v_coupon := NULLIF(v_quote ->> 'coupon_id', '')::uuid;

  IF v_org IS NULL THEN
    -- new_org não entra por este fluxo: o checkout recusa antes de criar objeto.
    RAISE EXCEPTION 'link % sem organizacao', v_link.id USING ERRCODE = '22023';
  END IF;
  IF p_period_end IS NULL OR p_period_start IS NULL THEN
    RAISE EXCEPTION 'invoice % sem periodo', p_invoice_id USING ERRCODE = '22023';
  END IF;

  -- O dinheiro é fato: entra no histórico em qualquer desfecho abaixo.
  INSERT INTO public.payment_history AS h (
    organization_id, provider, provider_payment_id, amount, discount_applied, coupon_id,
    billing_cycle, status, paid_at, period_start, period_end, billing_type)
  VALUES (
    v_org, 'stripe', p_invoice_id,
    p_amount_paid_cents / 100.0,
    COALESCE((v_quote ->> 'discount_amount_cents')::integer, 0) * v_months / 100.0,
    v_coupon,
    v_quote ->> 'billing_cycle',
    'received', v_paid_at,
    (p_period_start AT TIME ZONE 'UTC')::date,
    (p_period_end   AT TIME ZONE 'UTC')::date,
    'CREDIT_CARD')
  ON CONFLICT ON CONSTRAINT payment_history_provider_payment_key DO UPDATE
     SET status  = 'received',
         amount  = EXCLUDED.amount,
         paid_at = COALESCE(h.paid_at, EXCLUDED.paid_at);

  IF p_status <> 'active' THEN
    v_code := 'not_active';
  ELSE
    SELECT * INTO v_cur
      FROM public.org_subscriptions
     WHERE organization_id = v_org AND cancelled_at IS NULL
       FOR UPDATE;

    IF FOUND AND v_cur.provider_subscription_id IS DISTINCT FROM p_subscription_id THEN
      -- Duas assinaturas para a mesma org passaram pelo checkout em corrida. Não
      -- sobrescreve: o handler alarma e um humano decide qual cancelar.
      v_conflict := true;
      v_code := 'conflict';
    ELSIF FOUND THEN
      -- Renovação. Evento atrasado não recua o ponteiro: `greatest` é o que torna a
      -- corrida com customer.subscription.updated inofensiva.
      UPDATE public.org_subscriptions
         SET provider_payment_id  = CASE WHEN p_period_end >= COALESCE(renews_at, p_period_end)
                                         THEN p_invoice_id ELSE provider_payment_id END,
             renews_at            = GREATEST(renews_at, p_period_end),
             provider_status      = p_status,
             cancel_at_period_end = COALESCE(p_cancel_at_period_end, cancel_at_period_end),
             updated_at           = now()
       WHERE id = v_cur.id;
      v_code := 'applied';
    ELSE
      -- Primeira invoice: grava o snapshot. Exaustivo sobre o que é vendável: pacote,
      -- depois plano, depois o default do catálogo. Falso explícito de plano ou pacote
      -- vale; só a chave ausente herda o default. campaigns_manual, por exemplo, está
      -- fora dos 3 planos e tem default true: gravar false a tiraria de quem paga.
      SELECT * INTO v_plan FROM public.subscription_plans WHERE id = (v_quote ->> 'plan_id')::uuid;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'plano do link % ausente', v_link.id USING ERRCODE = 'P0002';
      END IF;

      SELECT COALESCE(jsonb_object_agg(
               fc.key,
               COALESCE(v_link.package_features -> fc.key, v_plan.features -> fc.key,
                        to_jsonb(fc.default_enabled), 'false'::jsonb)
             ), '{}'::jsonb)
        INTO v_features
        FROM public.feature_catalog fc
       WHERE fc.is_sellable;

      INSERT INTO public.org_subscriptions (
        organization_id, plan_id, billing_cycle, user_count, coupon_id, renews_at,
        base_amount_cents, discount_amount_cents, final_amount_cents,
        features, limits, payment_method,
        cycle_discount_pct, coupon_discount_pct,
        manual_discount_cents, manual_discount_reason, manual_discount_by, created_by,
        provider, provider_subscription_id, provider_payment_id, provider_status, cancel_at_period_end)
      VALUES (
        v_org, v_plan.id, v_quote ->> 'billing_cycle',
        GREATEST(COALESCE((v_quote ->> 'seats')::integer, 1), 1),
        v_coupon, p_period_end,
        -- Valores MENSAIS do quote: o motor define assim, e a tela exibe "Valor mensal".
        (v_quote ->> 'base_amount_cents')::integer,
        (v_quote ->> 'discount_amount_cents')::integer,
        (v_quote ->> 'final_amount_cents')::integer,
        v_features,
        v_plan.limits || COALESCE(v_link.package_limits, '{}'::jsonb),
        'credit_card',
        COALESCE((v_quote ->> 'cycle_discount_pct')::numeric, 0),
        COALESCE((v_quote ->> 'coupon_discount_pct')::numeric, 0),
        COALESCE((v_quote ->> 'manual_discount_cents')::integer, 0),
        v_link.manual_discount_reason,
        v_link.manual_discount_by,
        v_link.created_by,
        'stripe', p_subscription_id, p_invoice_id, p_status, COALESCE(p_cancel_at_period_end, false));
      v_code := 'applied';
    END IF;
  END IF;

  -- A primeira confirmação vale; reentrega não move o carimbo.
  UPDATE public.payment_links
     SET paid_at = v_paid_at
   WHERE id = v_link.id AND paid_at IS NULL;

  IF v_coupon IS NOT NULL THEN
    INSERT INTO public.coupon_redemptions (coupon_id, payment_id, organization_id, discount_applied_cents)
    SELECT v_coupon, v_charge.provider_charge_id, v_org,
           COALESCE((v_quote ->> 'coupon_discount_cents')::integer, 0) * v_months
    ON CONFLICT (coupon_id, payment_id) DO NOTHING;
  END IF;

  UPDATE public.payment_webhook_events
     SET status          = CASE WHEN v_conflict THEN 'failed' ELSE 'applied' END,
         error_message   = CASE WHEN v_conflict THEN 'org_conflict' END,
         organization_id = v_org,
         provider_payment_id = p_invoice_id,
         processed_at    = now()
   WHERE id = p_event_row_id;

  RETURN jsonb_build_object(
    'ok',              NOT v_conflict,
    'code',            v_code,
    'organization_id', v_org,
    'link_id',         v_link.id,
    -- Sinal, não recusa: o dinheiro já entrou. O handler alarma. Só no pagamento que
    -- chegou com o link já revogado: v_link guarda o paid_at de antes do carimbo acima, e
    -- revogar link já pago não pode alarmar em toda renovação.
    'link_revoked',    v_link.revoked_at IS NOT NULL AND v_link.paid_at IS NULL,
    'amount_mismatch', p_amount_paid_cents <> v_link.amount_cents
                       OR lower(COALESCE(p_currency, '')) <> 'brl');
END
$fn$;

-- ---------------------------------------------------------------------------
-- 7. invoice.payment_failed
--
-- Sem bloqueio nesta entrega: registra e espelha. INSERT sem update: `failed`
-- atrasado não rebaixa invoice já `received`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.billing_stripe_apply_invoice_failed(
  p_event_row_id      uuid,
  p_invoice_id        text,
  p_subscription_id   text,
  p_amount_due_cents  integer,
  p_period_start      timestamptz,
  p_period_end        timestamptz,
  p_status            text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_event  public.payment_webhook_events%ROWTYPE;
  v_org    uuid;
  v_cycle  text;
BEGIN
  PERFORM public.billing_stripe_assert_service();

  SELECT * INTO v_event FROM public.payment_webhook_events WHERE id = p_event_row_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'evento % ausente do ledger', p_event_row_id USING ERRCODE = 'P0002';
  END IF;
  IF v_event.status = 'applied' THEN
    RETURN jsonb_build_object('ok', true, 'code', 'already_applied');
  END IF;

  SELECT l.organization_id, l.quote ->> 'billing_cycle' INTO v_org, v_cycle
    FROM public.payment_link_charges c
    JOIN public.payment_links l ON l.id = c.payment_link_id
   WHERE c.provider_subscription_id = p_subscription_id;

  IF NOT FOUND OR v_org IS NULL THEN
    UPDATE public.payment_webhook_events
       SET status = 'ignored', error_message = 'subscription_unknown', processed_at = now()
     WHERE id = p_event_row_id;
    RETURN jsonb_build_object('ok', true, 'code', 'subscription_unknown');
  END IF;

  INSERT INTO public.payment_history (
    organization_id, provider, provider_payment_id, amount, billing_cycle, status,
    period_start, period_end, billing_type)
  VALUES (
    v_org, 'stripe', p_invoice_id, p_amount_due_cents / 100.0, v_cycle, 'failed',
    (p_period_start AT TIME ZONE 'UTC')::date,
    (p_period_end   AT TIME ZONE 'UTC')::date,
    'CREDIT_CARD')
  ON CONFLICT ON CONSTRAINT payment_history_provider_payment_key DO NOTHING;

  UPDATE public.org_subscriptions
     SET provider_status = p_status, updated_at = now()
   WHERE provider_subscription_id = p_subscription_id
     AND cancelled_at IS NULL;

  UPDATE public.payment_webhook_events
     SET status = 'applied', organization_id = v_org, provider_payment_id = p_invoice_id,
         processed_at = now()
   WHERE id = p_event_row_id;

  RETURN jsonb_build_object('ok', true, 'code', 'applied', 'organization_id', v_org);
END
$fn$;

-- ---------------------------------------------------------------------------
-- 8. customer.subscription.updated / deleted
--
-- NÃO toca `organizations`: esta entrega nunca rebaixa org. `greatest` em renews_at:
-- só avança.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.billing_stripe_mirror_subscription(
  p_event_row_id         uuid,
  p_subscription_id      text,
  p_status               text,
  p_period_end           timestamptz,
  p_cancel_at_period_end boolean,
  p_ended_at             timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_event public.payment_webhook_events%ROWTYPE;
  v_org   uuid;
BEGIN
  PERFORM public.billing_stripe_assert_service();

  SELECT * INTO v_event FROM public.payment_webhook_events WHERE id = p_event_row_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'evento % ausente do ledger', p_event_row_id USING ERRCODE = 'P0002';
  END IF;
  IF v_event.status = 'applied' THEN
    RETURN jsonb_build_object('ok', true, 'code', 'already_applied');
  END IF;

  UPDATE public.org_subscriptions
     SET provider_status      = p_status,
         renews_at            = GREATEST(renews_at, p_period_end),
         cancel_at_period_end = COALESCE(p_cancel_at_period_end, cancel_at_period_end),
         cancelled_at         = CASE WHEN p_status = 'canceled'
                                     THEN COALESCE(cancelled_at, p_ended_at, now())
                                     ELSE cancelled_at END,
         updated_at           = now()
   WHERE provider_subscription_id = p_subscription_id
  RETURNING organization_id INTO v_org;

  -- A assinatura incompleta muda de estado antes de a primeira invoice materializar a
  -- linha. Não é erro: invoice.paid recupera o estado atual quando chegar.
  IF v_org IS NULL THEN
    UPDATE public.payment_webhook_events
       SET status = 'ignored', error_message = 'subscription_not_materialized', processed_at = now()
     WHERE id = p_event_row_id;
    RETURN jsonb_build_object('ok', true, 'code', 'subscription_not_materialized');
  END IF;

  UPDATE public.payment_webhook_events
     SET status = 'applied', organization_id = v_org, processed_at = now()
   WHERE id = p_event_row_id;

  RETURN jsonb_build_object('ok', true, 'code', 'applied', 'organization_id', v_org);
END
$fn$;

-- ---------------------------------------------------------------------------
-- 9. Pendentes do worker: anti-join no banco
--
-- O worker aplicava `limit` antes do anti-join: 200 organizações já provisionadas na
-- frente da fila deixavam um pagante de fora para sempre.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.billing_pending_provisionings(p_limit integer DEFAULT 50)
RETURNS TABLE (provider_payment_id text, organization_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  PERFORM public.billing_stripe_assert_service();

  RETURN QUERY
  SELECT os.provider_payment_id, os.organization_id
    FROM public.org_subscriptions os
   WHERE os.provider_payment_id IS NOT NULL
     AND os.cancelled_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.subscription_provisionings sp
        WHERE sp.provider_payment_id = os.provider_payment_id)
   ORDER BY os.updated_at ASC
   LIMIT GREATEST(LEAST(COALESCE(p_limit, 50), 500), 1);
END
$fn$;

-- ---------------------------------------------------------------------------
-- 10. A provisão: livro primeiro, validade da assinatura, assento vira quota
--
-- `renews_at` preenchido (Stripe) é a validade: realinha, nunca soma. Nulo (Asaas,
-- que segue deployado e não grava renews_at) mantém a soma antiga.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.billing_provision_existing_org(
  p_provider_payment_id text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_sub   public.org_subscriptions%ROWTYPE;
  v_plan  text;
  v_meses integer;
  v_ate   timestamptz;
  v_novo  uuid;
BEGIN
  PERFORM public.billing_stripe_assert_service();

  SELECT * INTO v_sub
    FROM public.org_subscriptions
   WHERE provider_payment_id = p_provider_payment_id
     AND cancelled_at IS NULL
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'subscription_not_found');
  END IF;

  SELECT sp.name INTO v_plan
    FROM public.subscription_plans sp
   WHERE sp.id = v_sub.plan_id;

  IF v_plan IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'plan_not_found');
  END IF;

  IF v_sub.renews_at IS NOT NULL THEN
    v_ate := v_sub.renews_at;
  ELSE
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
  END IF;

  -- O LIVRO PRIMEIRO. Quem não inseriu não escreve mais nada.
  INSERT INTO public.subscription_provisionings
    (organization_id, provider_payment_id, target_kind, plan_name, activated_until)
  VALUES
    (v_sub.organization_id, p_provider_payment_id, 'existing_org', v_plan, v_ate)
  ON CONFLICT (provider_payment_id) DO NOTHING
  RETURNING id INTO v_novo;

  IF v_novo IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'code', 'already_provisioned',
                              'organization_id', v_sub.organization_id);
  END IF;

  -- `trg_sync_org_plan_quotas` sincroniza plan_base ao ver o nome do plano.
  UPDATE public.organizations
     SET subscription_status     = 'active',
         subscription_plan       = v_plan,
         subscription_expires_at = v_ate,
         updated_at              = now()
   WHERE id = v_sub.organization_id;

  -- #1564. Só depois do UPDATE, para ler o plan_base já sincronizado. Sem clawback:
  -- nenhum membro é removido se a quota cair. Plano ilimitado não recebe add-on.
  UPDATE public.org_quotas
     SET purchased_addons = GREATEST(v_sub.user_count - plan_base, 0),
         updated_at       = now()
   WHERE organization_id = v_sub.organization_id
     AND resource_key = 'max_users'
     AND plan_base <> -1;

  RETURN jsonb_build_object(
    'ok', true,
    'code', 'provisioned',
    'organization_id', v_sub.organization_id,
    'plan', v_plan,
    'active_until', v_ate);
END;
$$;

-- ---------------------------------------------------------------------------
-- 11. Grants, por extenso e por papel
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.billing_stripe_assert_service() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_stripe_assert_service() TO service_role;

REVOKE ALL ON FUNCTION public.billing_stripe_attach_checkout(uuid, text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_stripe_attach_checkout(uuid, text, text, text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.billing_stripe_record_consent(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_stripe_record_consent(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.billing_stripe_apply_invoice_paid(uuid, text, text, integer, text, timestamptz, timestamptz, timestamptz, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_stripe_apply_invoice_paid(uuid, text, text, integer, text, timestamptz, timestamptz, timestamptz, text, text, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.billing_stripe_apply_invoice_failed(uuid, text, text, integer, timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_stripe_apply_invoice_failed(uuid, text, text, integer, timestamptz, timestamptz, text) TO service_role;

REVOKE ALL ON FUNCTION public.billing_stripe_mirror_subscription(uuid, text, text, timestamptz, boolean, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_stripe_mirror_subscription(uuid, text, text, timestamptz, boolean, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.billing_pending_provisionings(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_pending_provisionings(integer) TO service_role;

REVOKE ALL ON FUNCTION public.billing_provision_existing_org(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_provision_existing_org(text) TO service_role;

REVOKE ALL ON FUNCTION public.billing_quote_price(uuid, integer, text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_quote_price(uuid, integer, text, text, text, integer) TO service_role;
