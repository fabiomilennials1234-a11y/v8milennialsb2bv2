-- supabase/tests/payment_history_receipt_period_method_test.sql
--
-- SCRUM-289 (parte 2) — as três faltas de `payment_history` que impediam a área
-- de billing do admin (#1390): recibo/fatura, período coberto e forma de
-- pagamento.
--
-- O que este arquivo segura, além de "a coluna existe":
--   - NULO é permitido nas cinco. Não existe escritor de `payment_history` no
--     repositório, então toda linha de produção veio por outro caminho e vai
--     ficar sem esses dados. Coluna NOT NULL aqui quebraria a ingestão que
--     ninguém tem em mãos.
--   - Os dois CHECK MORDEM: período invertido e forma de pagamento fora do
--     vocabulário são recusados. Sem estas asserções, o CHECK poderia ser
--     escrito errado e passar despercebido — constraint que não recusa nada é
--     documentação que se acha código.
--   - RLS continua ligada. Adicionar coluna não deveria mexer nisso, e é
--     exatamente por isso que vale afirmar.
--
-- Run: supabase db reset && bash supabase/tests/run.sh
-- Roda inteiro em transação revertida.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- ===========================================================================
-- (STRUCT) as cinco colunas, e todas aceitando NULO
-- ===========================================================================
SELECT has_column('public', 'payment_history', 'invoice_url',  '(STRUCT) invoice_url existe');
SELECT has_column('public', 'payment_history', 'receipt_url',  '(STRUCT) receipt_url existe');
SELECT has_column('public', 'payment_history', 'period_start', '(STRUCT) period_start existe');
SELECT has_column('public', 'payment_history', 'period_end',   '(STRUCT) period_end existe');
SELECT has_column('public', 'payment_history', 'billing_type', '(STRUCT) billing_type existe');

SELECT col_is_null('public', 'payment_history', 'invoice_url',  '(STRUCT) invoice_url aceita NULO (linha antiga não tem)');
SELECT col_is_null('public', 'payment_history', 'receipt_url',  '(STRUCT) receipt_url aceita NULO (só existe após liquidar)');
SELECT col_is_null('public', 'payment_history', 'period_start', '(STRUCT) period_start aceita NULO');
SELECT col_is_null('public', 'payment_history', 'period_end',   '(STRUCT) period_end aceita NULO');
SELECT col_is_null('public', 'payment_history', 'billing_type', '(STRUCT) billing_type aceita NULO');

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'payment_history'),
  '(STRUCT) RLS continua ligada em payment_history');

-- ===========================================================================
-- Fixtures
-- ===========================================================================
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug)
VALUES ('5c2c8289-0000-4000-8000-000000000001', 'Org SCRUM-289', 'org-scrum-289')
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = DEFAULT;

-- ===========================================================================
-- (PERÍODO) o CHECK morde de verdade
-- ===========================================================================
SELECT lives_ok(
  $$ INSERT INTO public.payment_history
       (organization_id, amount, billing_cycle, status, period_start, period_end, billing_type)
     VALUES ('5c2c8289-0000-4000-8000-000000000001', 510.00, 'semester', 'received',
             '2026-08-01', '2027-01-31', 'PIX') $$,
  '(PERÍODO) semestre coberto entra — é o caso que destrava o "Referente a"');

SELECT throws_ok(
  $$ INSERT INTO public.payment_history
       (organization_id, amount, billing_cycle, status, period_start, period_end)
     VALUES ('5c2c8289-0000-4000-8000-000000000001', 100.00, 'monthly', 'received',
             '2026-09-30', '2026-09-01') $$,
  '23514', NULL,
  '(PERÍODO) intervalo invertido é RECUSADO — dado corrompido que só apareceria na tela do cliente');

SELECT lives_ok(
  $$ INSERT INTO public.payment_history
       (organization_id, amount, billing_cycle, status, period_start, period_end)
     VALUES ('5c2c8289-0000-4000-8000-000000000001', 100.00, 'monthly', 'received',
             '2026-09-01', '2026-09-01') $$,
  '(PERÍODO) período de um dia só é válido (start = end)');

SELECT lives_ok(
  $$ INSERT INTO public.payment_history
       (organization_id, amount, billing_cycle, status)
     VALUES ('5c2c8289-0000-4000-8000-000000000001', 100.00, 'monthly', 'received') $$,
  '(PERÍODO) linha SEM período nenhum continua entrando — as antigas não morrem');

-- ===========================================================================
-- (FORMA) vocabulário fechado
-- ===========================================================================
SELECT lives_ok(
  $$ INSERT INTO public.payment_history
       (organization_id, amount, billing_cycle, status, billing_type)
     VALUES ('5c2c8289-0000-4000-8000-000000000001', 100.00, 'monthly', 'received', 'CREDIT_CARD') $$,
  '(FORMA) CREDIT_CARD entra');

SELECT throws_ok(
  $$ INSERT INTO public.payment_history
       (organization_id, amount, billing_cycle, status, billing_type)
     VALUES ('5c2c8289-0000-4000-8000-000000000001', 100.00, 'monthly', 'received', 'pix') $$,
  '23514', NULL,
  '(FORMA) minúscula é RECUSADA — é como "pix", "PIX" e "Pix" acabariam na mesma coluna');

SELECT throws_ok(
  $$ INSERT INTO public.payment_history
       (organization_id, amount, billing_cycle, status, billing_type)
     VALUES ('5c2c8289-0000-4000-8000-000000000001', 100.00, 'monthly', 'received', 'CRIPTO') $$,
  '23514', NULL,
  '(FORMA) valor fora do vocabulário do Asaas é RECUSADO na ingestão, não gravado como lixo');

-- ===========================================================================
-- (RECIBO) fatura e recibo são DOIS documentos, não um
-- ===========================================================================
SELECT lives_ok(
  $$ INSERT INTO public.payment_history
       (organization_id, amount, billing_cycle, status, invoice_url, receipt_url)
     VALUES ('5c2c8289-0000-4000-8000-000000000001', 100.00, 'monthly', 'received',
             'https://asaas.example/i/abc', NULL) $$,
  '(RECIBO) fatura sem recibo é estado VÁLIDO — emitida e ainda não liquidada');

SELECT is(
  (SELECT receipt_url FROM public.payment_history
    WHERE organization_id = '5c2c8289-0000-4000-8000-000000000001'
      AND invoice_url = 'https://asaas.example/i/abc'),
  NULL,
  '(RECIBO) e o recibo fica NULO até existir — sem inventar a URL do que não foi pago');

SELECT * FROM finish();
ROLLBACK;
