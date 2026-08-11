-- supabase/tests/payment_webhook_ledger_test.sql
--
-- SCRUM-287 (Fatia 6) — o que faz a re-entrega do gateway ser inofensiva.
--
-- A entrega do Asaas é at-least-once e o `id` do evento (`evt_…`) se repete na
-- re-entrega. A idempotência, portanto, não é escolha de implementação: ou o
-- BANCO recusa a segunda linha, ou o handler perde a corrida entre duas
-- entregas simultâneas — um `SELECT` antes do `INSERT` não protege nada quando
-- os dois chegam no mesmo milissegundo.
--
-- O que este arquivo segura:
--   1. o MESMO `evt_…` duas vezes produz UMA linha;
--   2. o mesmo cupom no mesmo pagamento produz UM resgate — e no pagamento
--      SEGUINTE produz outro, senão o cupom valeria uma vez na vida;
--   3. evento de tipo DESCONHECIDO cabe no vocabulário (`unknown_type`) em vez
--      de não ter onde ser gravado — porque devolver erro ao provedor pausa a
--      fila e derruba o recebimento de TODA a receita;
--   4. nenhum dos dois livros é alcançável por `anon` ou `authenticated`;
--   5. `increment_coupon_uses` deixa de ser acionável por usuário logado.
--
-- Run: supabase db reset && bash supabase/tests/run.sh
-- Roda inteiro em transação revertida.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- ===========================================================================
-- (STRUCT) os dois livros e as duas chaves
-- ===========================================================================
SELECT has_table('public', 'payment_webhook_events', '(STRUCT) livro de eventos do gateway existe');
SELECT has_table('public', 'coupon_redemptions',     '(STRUCT) livro de resgates existe');

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'payment_webhook_events'),
  '(STRUCT) RLS ligada em payment_webhook_events');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'coupon_redemptions'),
  '(STRUCT) RLS ligada em coupon_redemptions');

-- Os índices são o contrato, não detalhe: é neles que a idempotência mora.
SELECT ok(
  (SELECT count(*) = 1 FROM pg_indexes
    WHERE tablename = 'payment_webhook_events' AND indexdef ILIKE '%UNIQUE%(provider, provider_event_id)%'),
  '(STRUCT) UNIQUE (provider, provider_event_id) — a chave da re-entrega');

SELECT ok(
  (SELECT count(*) = 1 FROM pg_indexes
    WHERE tablename = 'coupon_redemptions' AND indexdef ILIKE '%UNIQUE%(coupon_id, payment_id)%'),
  '(STRUCT) UNIQUE (coupon_id, payment_id) — a chave do resgate');

-- ===========================================================================
-- (ALCANCE) nenhum usuário do navegador chega nos livros
-- ===========================================================================
SELECT ok(
  NOT has_table_privilege('anon', 'public.payment_webhook_events', 'SELECT'),
  '(ALCANCE) anon NÃO lê o livro de eventos (ele carrega o payload cru do gateway)');
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.payment_webhook_events', 'SELECT'),
  '(ALCANCE) authenticated NÃO lê o livro de eventos');
SELECT ok(
  NOT has_table_privilege('anon', 'public.coupon_redemptions', 'SELECT'),
  '(ALCANCE) anon NÃO lê o livro de resgates');
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.coupon_redemptions', 'SELECT'),
  '(ALCANCE) authenticated NÃO lê o livro de resgates');

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.increment_coupon_uses(uuid)', 'EXECUTE'),
  '(ALCANCE) increment_coupon_uses NÃO é acionável por usuário logado — queimar uso de cupom alheio era um POST');
SELECT ok(
  has_function_privilege('service_role', 'public.increment_coupon_uses(uuid)', 'EXECUTE'),
  '(ALCANCE) e continua acionável por service_role — a projeção não morreu junto');

-- ===========================================================================
-- Fixtures
-- ===========================================================================
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug)
VALUES ('5c2c8287-0000-4000-8000-000000000001', 'Org SCRUM-287', 'org-scrum-287')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.coupons (id, code, discount_pct, max_uses, current_uses, is_active)
VALUES ('c0000287-0000-4000-8000-000000000001', 'MILENNIALS35-TESTE', 35, 1, 0, true)
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = DEFAULT;

-- ===========================================================================
-- (REENTREGA) o mesmo evento duas vezes produz UMA linha
-- ===========================================================================
INSERT INTO public.payment_webhook_events (provider_event_id, event_type, payload)
VALUES ('evt_8f2c1a9b&c3d4e5f6', 'PAYMENT_RECEIVED', '{"id":"evt_8f2c1a9b&c3d4e5f6"}'::jsonb);

-- A segunda entrega. `ON CONFLICT DO NOTHING` é o que o handler faz: o 23505 é
-- tratado como SUCESSO, não como erro — devolver erro ao provedor por causa de
-- uma re-entrega pausaria a fila.
WITH ins AS (
  INSERT INTO public.payment_webhook_events (provider_event_id, event_type, payload)
  VALUES ('evt_8f2c1a9b&c3d4e5f6', 'PAYMENT_RECEIVED', '{"id":"evt_8f2c1a9b&c3d4e5f6"}'::jsonb)
  ON CONFLICT DO NOTHING
  RETURNING id
)
SELECT is((SELECT count(*)::int FROM ins), 0,
  '(REENTREGA) a segunda entrega do mesmo evt_ não insere nada');

SELECT is(
  (SELECT count(*)::int FROM public.payment_webhook_events
    WHERE provider_event_id = 'evt_8f2c1a9b&c3d4e5f6'),
  1,
  '(REENTREGA) e o livro fica com UMA linha — não duas');

-- O id do evento tem `&` e ~50 chars no exemplo oficial. Coluna `text`, e a
-- asserção existe porque um `varchar(n)` apertado truncaria a chave e faria
-- dois eventos diferentes colidirem.
SELECT lives_ok(
  $$ INSERT INTO public.payment_webhook_events (provider_event_id, event_type, payload)
     VALUES ('evt_' || repeat('a1b2&', 40), 'PAYMENT_CONFIRMED', '{}'::jsonb) $$,
  '(REENTREGA) id de evento longo e com & entra inteiro — a chave não é truncada');

-- Evento do MESMO pagamento com tipo diferente NÃO é duplicata: o Asaas emite
-- CONFIRMED e depois RECEIVED para a mesma cobrança, e no estorno emite de
-- novo. Deduplicar por pagamento colapsaria eventos legítimos.
SELECT lives_ok(
  $$ INSERT INTO public.payment_webhook_events (provider_event_id, event_type, provider_payment_id, payload)
     VALUES ('evt_outro_evento_mesmo_pagamento', 'PAYMENT_CONFIRMED', 'pay_123', '{}'::jsonb) $$,
  '(REENTREGA) evento diferente do mesmo pagamento entra — dedup é por EVENTO, não por cobrança');

-- ===========================================================================
-- (DESCONHECIDO) o tipo que não sabemos tratar tem onde ser gravado
-- ===========================================================================
SELECT lives_ok(
  $$ INSERT INTO public.payment_webhook_events (provider_event_id, event_type, status, payload)
     VALUES ('evt_tipo_novo_da_asaas', 'PAYMENT_TIPO_QUE_AINDA_NAO_EXISTE', 'unknown_type', '{}'::jsonb) $$,
  '(DESCONHECIDO) tipo novo é ABSORVIDO com status unknown_type — em vez de virar erro que pausa a fila');

SELECT throws_ok(
  $$ INSERT INTO public.payment_webhook_events (provider_event_id, event_type, status, payload)
     VALUES ('evt_status_invalido', 'PAYMENT_RECEIVED', 'inventado', '{}'::jsonb) $$,
  '23514', NULL,
  '(DESCONHECIDO) mas o vocabulário de STATUS continua fechado — absorver evento não é aceitar qualquer coisa');

-- ===========================================================================
-- (CUPOM) consumir é INSERIR, e a segunda vez é recusada pelo BANCO
-- ===========================================================================
INSERT INTO public.coupon_redemptions (coupon_id, payment_id, organization_id, discount_applied_cents)
VALUES ('c0000287-0000-4000-8000-000000000001', 'pay_abc', '5c2c8287-0000-4000-8000-000000000001', 17500);

WITH ins AS (
  INSERT INTO public.coupon_redemptions (coupon_id, payment_id, organization_id, discount_applied_cents)
  VALUES ('c0000287-0000-4000-8000-000000000001', 'pay_abc', '5c2c8287-0000-4000-8000-000000000001', 17500)
  ON CONFLICT DO NOTHING
  RETURNING id
)
SELECT is((SELECT count(*)::int FROM ins), 0,
  '(CUPOM) o mesmo cupom no mesmo pagamento não resgata duas vezes — a re-entrega é inofensiva por construção');

SELECT is(
  (SELECT count(*)::int FROM public.coupon_redemptions
    WHERE coupon_id = 'c0000287-0000-4000-8000-000000000001'),
  1,
  '(CUPOM) UM resgate no livro');

SELECT lives_ok(
  $$ INSERT INTO public.coupon_redemptions (coupon_id, payment_id, organization_id)
     VALUES ('c0000287-0000-4000-8000-000000000001', 'pay_OUTRO', '5c2c8287-0000-4000-8000-000000000001') $$,
  '(CUPOM) e o MESMO cupom em OUTRO pagamento resgata de novo — senão o cupom valeria uma vez na vida');

-- O livro responde o que o contador nunca respondeu: QUEM, QUANDO, EM QUAL
-- pagamento. Sem esta asserção, `coupon_redemptions` poderia nascer sem a
-- coluna que justifica sua existência.
SELECT is(
  (SELECT count(*)::int FROM public.coupon_redemptions
    WHERE coupon_id = 'c0000287-0000-4000-8000-000000000001'
      AND organization_id = '5c2c8287-0000-4000-8000-000000000001'
      AND redeemed_at IS NOT NULL),
  2,
  '(CUPOM) cada resgate diz de quem é e quando foi');

-- ===========================================================================
-- (ASSINATURA) o schema já decide: UMA assinatura viva por organização
--
-- Medido antes de escrever o handler, e mudou o desenho da fatia: não dá para
-- gravar uma linha por ciclo pago — `org_subscriptions_one_current_per_org`
-- recusa a segunda. A renovação ATUALIZA a corrente, e quem guarda o histórico
-- do que foi pago é `payment_history`.
-- ===========================================================================
SELECT has_column('public', 'org_subscriptions', 'provider_payment_id',
  '(ASSINATURA) a assinatura corrente sabe QUAL cobrança a pagou — a primeira pergunta de uma disputa');

SELECT ok(
  (SELECT count(*) = 1 FROM pg_indexes
    WHERE tablename = 'org_subscriptions'
      AND indexname = 'org_subscriptions_one_current_per_org'),
  '(ASSINATURA) e o índice que garante UMA viva por org continua de pé — é ele a idempotência, não um IF no handler');

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.subscription_plans (id, name, display_name, limits)
VALUES ('91a17287-0000-4000-8000-000000000001', 'pro-scrum-287', 'Pro (fixture 287)', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = DEFAULT;

INSERT INTO public.org_subscriptions
  (organization_id, plan_id, billing_cycle, payment_method, provider, provider_payment_id,
   final_amount_cents, base_amount_cents)
VALUES ('5c2c8287-0000-4000-8000-000000000001', '91a17287-0000-4000-8000-000000000001',
        'annual', 'pix', 'asaas', 'pay_assinatura_1', 19900, 19900);

-- O segundo evento da MESMA cobrança (o RECEIVED que chega 32 dias depois do
-- CONFIRMED, no cartão) escreve pelo mesmo caminho do handler: ON CONFLICT
-- sobre o índice parcial. Uma linha, valores atualizados — nunca duas.
INSERT INTO public.org_subscriptions
  (organization_id, plan_id, billing_cycle, payment_method, provider, provider_payment_id,
   final_amount_cents, base_amount_cents)
VALUES ('5c2c8287-0000-4000-8000-000000000001', '91a17287-0000-4000-8000-000000000001',
        'annual', 'pix', 'asaas', 'pay_assinatura_1', 19900, 19900)
ON CONFLICT (organization_id) WHERE cancelled_at IS NULL
DO UPDATE SET provider_payment_id = EXCLUDED.provider_payment_id, updated_at = now();

SELECT is(
  (SELECT count(*)::int FROM public.org_subscriptions
    WHERE organization_id = '5c2c8287-0000-4000-8000-000000000001' AND cancelled_at IS NULL),
  1,
  '(ASSINATURA) o par CONFIRMED/RECEIVED da mesma cobrança deixa UMA assinatura viva');

SELECT is(
  (SELECT provider_payment_id FROM public.org_subscriptions
    WHERE organization_id = '5c2c8287-0000-4000-8000-000000000001' AND cancelled_at IS NULL),
  'pay_assinatura_1',
  '(ASSINATURA) e ela aponta para a cobrança que a pagou');

SELECT throws_ok(
  $$ INSERT INTO public.org_subscriptions
       (organization_id, plan_id, billing_cycle, payment_method, provider, final_amount_cents, base_amount_cents)
     VALUES ('5c2c8287-0000-4000-8000-000000000001', '91a17287-0000-4000-8000-000000000001',
             'annual', 'pix', 'manual', 19900, 19900) $$,
  '23505', NULL,
  '(ASSINATURA) e uma SEGUNDA assinatura viva é recusada pelo banco — é isto que impede "append-only por ciclo" aqui');

SELECT * FROM finish();
ROLLBACK;
