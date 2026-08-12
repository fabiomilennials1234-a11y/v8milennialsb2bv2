-- supabase/tests/provision_new_org_test.sql
--
-- Fatia 9 (parte 2) — pagamento de organização NOVA vira organização + acesso.
--
-- O que este arquivo segura, em ordem de gravidade:
--   1. o pagamento sem comprador NÃO some: vira linha BLOQUEADA e visível, que
--      é a única situação desta fatia em que silêncio custa dinheiro do cliente;
--   2. o alarme sai UMA vez, não a cada passada do worker (2 em 2 minutos);
--   3. tudo ou nada: organização, histórico, assinatura e ativação numa
--      transação — estado intermediário exigiria caminho de conserto;
--   4. a COTA chega sem ninguém escrever cota (o gatilho da SCRUM-338);
--   5. a re-entrega não cria uma segunda organização.
--
-- Run: supabase db reset && bash supabase/tests/run.sh

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- ===========================================================================
-- (STRUCT) o livro passa a registrar desfecho
-- ===========================================================================
SELECT has_column('public', 'subscription_provisionings', 'status', '(STRUCT) o livro tem estado');
SELECT col_is_null('public', 'subscription_provisionings', 'organization_id',
  '(STRUCT) organization_id aceita NULO — bloqueado no new_org ainda não tem dono');

SELECT ok(
  (SELECT count(*) = 1 FROM pg_constraint
    WHERE conname = 'subscription_provisionings_org_when_provisioned'),
  '(STRUCT) mas PROVISIONADO sem dono é proibido — linha órfã é pior que ausência');

SELECT ok(
  (SELECT count(*) = 1 FROM pg_indexes
    WHERE indexname = 'idx_subscription_provisionings_blocked'),
  '(STRUCT) índice parcial dos bloqueados — a pergunta das 3 da manhã tem onde ser feita');

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.billing_provision_new_org(text,text)', 'EXECUTE'),
  '(GRANT) authenticated NÃO cria organização paga');
SELECT ok(
  has_function_privilege('service_role', 'public.billing_provision_new_org(text,text)', 'EXECUTE'),
  '(GRANT) service_role cria — é quem o worker usa');

-- ===========================================================================
-- Fixtures: um link de organização NOVA, com cobrança
-- ===========================================================================
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug)
VALUES ('0e00000e-0000-4000-8000-000000000001', 'Org criadora', 'org-criadora-9b')
ON CONFLICT (id) DO NOTHING;

-- O plano com limites conhecidos. UPDATE em quem existe, INSERT em quem falta:
-- base limpa não tem catálogo semeado, e base clonada de produção tem — o
-- fixture precisa valer nas duas.
UPDATE public.subscription_plans
   SET limits = jsonb_build_object('max_users', 7, 'max_whatsapp_instances', 2, 'max_copilot_agents', 2)
 WHERE name = 'pro';

INSERT INTO public.subscription_plans (name, display_name, limits)
SELECT 'pro', 'Pro (fixture new_org)',
       jsonb_build_object('max_users', 7, 'max_whatsapp_instances', 2, 'max_copilot_agents', 2)
 WHERE NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE name = 'pro');

SET LOCAL session_replication_role = DEFAULT;

INSERT INTO public.payment_links
  (id, token_hash, target_kind, new_org_name, quote, amount_cents, expires_at, created_by)
VALUES
  ('0e00000e-0000-4000-8000-0000000000aa', repeat('e', 64), 'new_org', 'Padaria Aurora Ltda',
   jsonb_build_object(
     'plan_id', (SELECT id FROM public.subscription_plans WHERE name = 'pro' LIMIT 1),
     'billing_cycle', 'annual', 'payment_method', 'pix', 'seats', 7,
     'base_amount_cents', 120000, 'charge_cents', 100000,
     'cycle_discount_cents', 20000, 'coupon_discount_cents', 0, 'manual_discount_cents', 0,
     'cycle_discount_pct', 15, 'coupon_discount_pct', 0),
   100000, now() + interval '7 days', '0e00000e-0000-4000-8000-000000000001');

INSERT INTO public.payment_link_charges (payment_link_id, method, provider, provider_charge_id)
VALUES ('0e00000e-0000-4000-8000-0000000000aa', 'pix', 'asaas', 'pay_new_1');

-- ===========================================================================
-- (BLOQUEIO) pagamento confirmado sem comprador não some
-- ===========================================================================
SELECT is(
  (SELECT public.billing_block_provisioning('pay_new_1', 'buyer_missing') ->> 'alarmou'),
  'true',
  '(BLOQUEIO) a primeira vez ALARMA');

SELECT is(
  (SELECT status || '|' || coalesce(blocked_code, '-') || '|' || coalesce(organization_id::text, 'sem-dono')
     FROM public.subscription_provisionings WHERE provider_payment_id = 'pay_new_1'),
  'blocked|buyer_missing|sem-dono',
  '(BLOQUEIO) e o livro guarda o estado visível, sem inventar dono');

SELECT is(
  (SELECT public.billing_block_provisioning('pay_new_1', 'buyer_missing') ->> 'alarmou'),
  'false',
  '(BLOQUEIO) a segunda passada do worker NÃO alarma de novo — repetir a cada 2 min afogaria o sinal');

-- ===========================================================================
-- (PROVISIONA) com o comprador, tudo numa transação
-- ===========================================================================
SELECT is(
  (SELECT public.billing_provision_new_org('pay_new_1', 'dono@padariaaurora.com.br') ->> 'code'),
  'provisioned',
  '(PROVISIONA) a organização nova nasce');

SELECT is(
  (SELECT subscription_status || '|' || subscription_plan FROM public.organizations
    WHERE id = (SELECT organization_id FROM public.subscription_provisionings
                 WHERE provider_payment_id = 'pay_new_1')),
  'active|pro',
  '(PROVISIONA) já ativa e com o NOME do plano — que é o que o gate comercial lê');

SELECT is(
  (SELECT plan_base FROM public.org_quotas
    WHERE organization_id = (SELECT organization_id FROM public.subscription_provisionings
                              WHERE provider_payment_id = 'pay_new_1')
      AND resource_key = 'max_users'),
  7,
  '(COTA) veio do PLANO sem ninguém escrever cota — quem sincronizou foi trg_sync_org_plan_quotas');

SELECT is(
  (SELECT count(*)::int FROM public.payment_history WHERE asaas_payment_id = 'pay_new_1'),
  1,
  '(HISTÓRICO) a linha nasce AGORA, que é quando existe dono — organization_id não afrouxou');

SELECT is(
  (SELECT count(*)::int FROM public.org_subscriptions
    WHERE provider_payment_id = 'pay_new_1' AND cancelled_at IS NULL),
  1,
  '(ASSINATURA) uma assinatura viva para a organização nova');

SELECT ok(
  (SELECT paid_at IS NOT NULL FROM public.payment_links
    WHERE id = '0e00000e-0000-4000-8000-0000000000aa'),
  '(LINK) e o link fica marcado como pago — a proposta não aceita cobrança nova');

SELECT is(
  (SELECT status || '|' || coalesce(blocked_code, '-') FROM public.subscription_provisionings
    WHERE provider_payment_id = 'pay_new_1'),
  'provisioned|-',
  '(BLOQUEIO) o bloqueio some quando o provisionamento acontece — o livro conta o desfecho, não a tentativa');

-- ===========================================================================
-- (REENTREGA) o par CONFIRMED/RECEIVED não cria uma segunda organização
-- ===========================================================================
SELECT is(
  (SELECT public.billing_provision_new_org('pay_new_1', 'dono@padariaaurora.com.br') ->> 'code'),
  'already_provisioned',
  '(REENTREGA) a segunda entrega reconhece o que já existe');

SELECT is(
  (SELECT count(*)::int FROM public.organizations WHERE slug LIKE 'padaria-aurora%'),
  1,
  '(REENTREGA) e existe UMA organização — não duas com o mesmo nome');

-- ===========================================================================
-- (CAMINHO ERRADO) link de organização existente é recusado aqui
-- ===========================================================================
INSERT INTO public.payment_links
  (id, token_hash, target_kind, organization_id, quote, amount_cents, expires_at, created_by)
VALUES
  ('0e00000e-0000-4000-8000-0000000000bb', repeat('f', 64), 'existing_org',
   '0e00000e-0000-4000-8000-000000000001', '{}'::jsonb, 19900,
   now() + interval '7 days', '0e00000e-0000-4000-8000-000000000001');

INSERT INTO public.payment_link_charges (payment_link_id, method, provider, provider_charge_id)
VALUES ('0e00000e-0000-4000-8000-0000000000bb', 'pix', 'asaas', 'pay_existente_1');

SELECT is(
  (SELECT public.billing_provision_new_org('pay_existente_1', 'alguem@exemplo.com') ->> 'code'),
  'not_new_org',
  '(CAMINHO ERRADO) organização existente é recusada aqui — senão quem já tem org ganharia uma segunda');

SELECT is(
  (SELECT public.billing_provision_new_org('pay_inexistente', 'alguem@exemplo.com') ->> 'code'),
  'charge_not_found',
  '(ORDEM) cobrança desconhecida recusa limpo — é ordem de chegada, não incidente');

SELECT is(
  (SELECT public.billing_provision_new_org('pay_new_1', NULL) ->> 'code'),
  'already_provisioned',
  '(EMAIL) e-mail ausente não derruba o que já foi provisionado');

SELECT * FROM finish();
ROLLBACK;
