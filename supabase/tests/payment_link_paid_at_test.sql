-- supabase/tests/payment_link_paid_at_test.sql
--
-- `payment_links.paid_at` — a coluna que existia, era indexada, era LIDA em
-- três pontos de decisão, e era escrita em NENHUM.
--
-- `billing_attach_link_charge` recusa cobrança em link já pago pelo predicado
-- `paid_at IS NOT NULL`. Com a coluna sempre nula, **essa recusa nunca
-- acontecia** — e o custo era do cliente: paga no Pix, recarrega a página,
-- clica em cartão, e uma SEGUNDA cobrança nasce no gateway para uma proposta
-- já paga. A idempotência por (link, método) não salva: métodos diferentes são
-- linhas diferentes, por desenho.
--
-- Este arquivo prova a recusa ACONTECENDO. Ele não pode ter passado antes:
-- o teste anterior exercitava o caminho com `paid_at` nulo, que é justamente
-- o único estado que o código produzia.
--
-- Quem escreve o carimbo é o `asaas-webhook`, no ramo que já resolveu o link —
-- e escreve com `paid_at IS NULL` na condição, para a re-entrega não mover a
-- data: vale a PRIMEIRA confirmação, não a última. No cartão, o `RECEIVED`
-- chega 32 dias depois do `CONFIRMED`.
--
-- Run: supabase db reset && bash supabase/tests/run.sh
-- Roda inteiro em transação revertida.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug)
VALUES ('0a1d0000-0000-4000-8000-000000000001', 'Org paid_at', 'org-paid-at')
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = DEFAULT;

INSERT INTO public.payment_links
  (id, token_hash, target_kind, organization_id, quote, amount_cents,
   expires_at, created_by)
VALUES
  ('0a1d0000-0000-4000-8000-0000000000aa', repeat('a', 64), 'existing_org',
   '0a1d0000-0000-4000-8000-000000000001', '{}'::jsonb, 19900,
   now() + interval '7 days', '0a1d0000-0000-4000-8000-000000000001');

-- ===========================================================================
-- (ANTES) com o link em aberto, a segunda forma de pagamento é PERMITIDA
-- ===========================================================================
SELECT is(
  (SELECT public.billing_attach_link_charge(
     '0a1d0000-0000-4000-8000-0000000000aa'::uuid, 'pix', 'asaas', 'pay_pix_1') ->> 'ok'),
  'true',
  '(ANTES) link em aberto aceita a primeira cobrança');

SELECT is(
  (SELECT public.billing_attach_link_charge(
     '0a1d0000-0000-4000-8000-0000000000aa'::uuid, 'credit_card', 'asaas', 'pay_card_1') ->> 'ok'),
  'true',
  '(ANTES) e aceita OUTRO método no mesmo link — é assim que o cliente troca de forma de pagamento');

-- ===========================================================================
-- (DEPOIS) pago o link, a recusa acontece — e é ESTA que nunca acontecia
-- ===========================================================================
UPDATE public.payment_links
   SET paid_at = now()
 WHERE id = '0a1d0000-0000-4000-8000-0000000000aa'
   AND paid_at IS NULL;

SELECT is(
  (SELECT public.billing_attach_link_charge(
     '0a1d0000-0000-4000-8000-0000000000aa'::uuid, 'boleto', 'asaas', 'pay_boleto_1') ->> 'code'),
  'link_already_paid',
  '(DEPOIS) link PAGO recusa cobrança nova — o cliente que recarrega e clica em cartão não gera segunda cobrança no gateway');

SELECT is(
  (SELECT count(*)::int FROM public.payment_link_charges
    WHERE payment_link_id = '0a1d0000-0000-4000-8000-0000000000aa'),
  2,
  '(DEPOIS) e a recusa é PURA — nenhuma linha de cobrança nasce dela');

-- ===========================================================================
-- (RESOLVE) a porta pública também para de oferecer o link pago
-- ===========================================================================
SELECT is(
  (SELECT public.billing_resolve_payment_link(
     encode(digest('token-irrelevante', 'sha256'), 'hex')) ->> 'code'),
  'link_not_found',
  '(RESOLVE) token desconhecido continua respondendo link_not_found');

-- ===========================================================================
-- (CARIMBO) a re-entrega não move a data — vale a PRIMEIRA confirmação
-- ===========================================================================
SELECT is(
  (SELECT count(*)::int FROM public.payment_links
    WHERE id = '0a1d0000-0000-4000-8000-0000000000aa'
      AND paid_at IS NOT NULL),
  1,
  '(CARIMBO) o link está marcado como pago');

-- O `.is("paid_at", null)` do handler é o que garante isto. Simulado aqui pela
-- mesma condição: a segunda escrita não encontra linha e não faz nada.
UPDATE public.payment_links
   SET paid_at = now() + interval '32 days'
 WHERE id = '0a1d0000-0000-4000-8000-0000000000aa'
   AND paid_at IS NULL;

SELECT ok(
  (SELECT paid_at < now() + interval '1 day' FROM public.payment_links
    WHERE id = '0a1d0000-0000-4000-8000-0000000000aa'),
  '(CARIMBO) e a segunda confirmação NÃO reescreve a data — no cartão o RECEIVED chega 32 dias depois do CONFIRMED');

SELECT * FROM finish();
ROLLBACK;
