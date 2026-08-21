-- supabase/tests/provision_existing_org_test.sql
--
-- Fatia 9 (parte 1) — o pagamento vira ACESSO para organização existente.
--
-- A asserção que manda não é "a linha foi escrita": é que a COTA chega sem
-- ninguém escrever cota. O provisionamento grava o NOME do plano em
-- `organizations.subscription_plan`, e `trg_sync_org_plan_quotas` (SCRUM-338)
-- sincroniza `org_quotas.plan_base` sozinho. Se um dia alguém "otimizar"
-- escrevendo a cota direto, esta suíte continua verde — e por isso há também
-- uma asserção de que a linha de cota veio com o valor DO PLANO, que é o que
-- prova que o caminho foi o gatilho e não a mão.
--
-- Run: supabase db reset && bash supabase/tests/run.sh
-- Roda inteiro em transação revertida.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- ===========================================================================
-- (STRUCT) livro, chave e alcance
-- ===========================================================================
SELECT has_table('public', 'subscription_provisionings', '(STRUCT) livro de provisionamentos existe');

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'subscription_provisionings'),
  '(STRUCT) RLS ligada');

SELECT ok(
  (SELECT count(*) = 1 FROM pg_indexes
    WHERE tablename = 'subscription_provisionings'
      AND indexdef ILIKE '%UNIQUE%(provider_payment_id)%'),
  '(STRUCT) UNIQUE (provider_payment_id) — a idempotência do par CONFIRMED/RECEIVED');

SELECT ok(
  NOT has_table_privilege('anon', 'public.subscription_provisionings', 'SELECT'),
  '(ALCANCE) anon não lê o livro');
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.subscription_provisionings', 'SELECT'),
  '(ALCANCE) authenticated não lê o livro');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.billing_provision_existing_org(text)', 'EXECUTE'),
  '(ALCANCE) authenticated NÃO ativa organização — a 25ª RPC cross-tenant não nasce aqui');
SELECT ok(
  has_function_privilege('service_role', 'public.billing_provision_existing_org(text)', 'EXECUTE'),
  '(ALCANCE) service_role ativa — é quem o worker usa');

-- ===========================================================================
-- Fixtures
-- ===========================================================================
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, subscription_status, subscription_plan)
VALUES ('09000009-0000-4000-8000-000000000001', 'Org Fatia 9', 'org-fatia-9', 'trial', NULL)
ON CONFLICT (id) DO NOTHING;

-- O plano com limites conhecidos: é por eles que a cota tem que chegar.
UPDATE public.subscription_plans
   SET limits = jsonb_build_object('max_users', 9, 'max_whatsapp_instances', 4, 'max_copilot_agents', 3)
 WHERE name = 'pro';

INSERT INTO public.subscription_plans (id, name, display_name, limits)
SELECT '09000009-0000-4000-8000-0000000000f0', 'pro', 'Pro (fixture 9)',
       jsonb_build_object('max_users', 9, 'max_whatsapp_instances', 4, 'max_copilot_agents', 3)
 WHERE NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE name = 'pro');

SET LOCAL session_replication_role = DEFAULT;

-- A assinatura que a Fatia 6 escreveu.
SELECT public.billing_apply_paid_subscription(
  '09000009-0000-4000-8000-000000000001'::uuid,
  (SELECT id FROM public.subscription_plans WHERE name = 'pro' LIMIT 1),
  'annual', 'pix', 'pay_f9_1',
  9, 120000, 0, 120000, 0, 0, 0, NULL, 'asaas');

-- ===========================================================================
-- (RECUSA LIMPA) cobrança sem assinatura não é incidente
-- ===========================================================================
SELECT is(
  (SELECT public.billing_provision_existing_org('pay_que_nao_existe') ->> 'code'),
  'subscription_not_found',
  '(ORDEM) cobrança sem assinatura recusa LIMPO — é ordem de chegada, não erro');

-- ===========================================================================
-- (ATIVA) o pagamento vira acesso
-- ===========================================================================
SELECT is(
  (SELECT public.billing_provision_existing_org('pay_f9_1') ->> 'code'),
  'provisioned',
  '(ATIVA) o provisionamento roda');

SELECT is(
  (SELECT subscription_status FROM public.organizations
    WHERE id = '09000009-0000-4000-8000-000000000001'),
  'active',
  '(ATIVA) a organização sai de trial');

SELECT is(
  (SELECT subscription_plan FROM public.organizations
    WHERE id = '09000009-0000-4000-8000-000000000001'),
  'pro',
  '(ATIVA) com o NOME do plano — que é o que o gate comercial lê');

SELECT ok(
  (SELECT subscription_expires_at > now() + interval '360 days'
     FROM public.organizations WHERE id = '09000009-0000-4000-8000-000000000001'),
  '(ATIVA) e com vencimento a um ano — ciclo anual vira 12 meses, não um mês');

-- ===========================================================================
-- (COTA) a asserção que mais importa: ninguém escreveu cota, e ela chegou
-- ===========================================================================
SELECT is(
  (SELECT plan_base FROM public.org_quotas
    WHERE organization_id = '09000009-0000-4000-8000-000000000001'
      AND resource_key = 'max_users'),
  9,
  '(COTA) org_quotas.plan_base veio do PLANO sem ninguém escrever cota — quem sincronizou foi trg_sync_org_plan_quotas');

SELECT is(
  (SELECT plan_base FROM public.org_quotas
    WHERE organization_id = '09000009-0000-4000-8000-000000000001'
      AND resource_key = 'max_whatsapp_instances'),
  4,
  '(COTA) e o segundo recurso também — a fatia não toca org_quotas');

-- ===========================================================================
-- (IDEMPOTENTE) o par CONFIRMED/RECEIVED ativa UMA vez
-- ===========================================================================
SELECT lives_ok(
  $$ SELECT public.billing_provision_existing_org('pay_f9_1') $$,
  '(IDEMPOTENTE) a segunda entrega da mesma cobrança não estoura');

SELECT is(
  (SELECT count(*)::int FROM public.subscription_provisionings
    WHERE provider_payment_id = 'pay_f9_1'),
  1,
  '(IDEMPOTENTE) e o livro fica com UMA linha');

-- ===========================================================================
-- (RENOVA) o ciclo seguinte SOMA sobre o vencimento, não recomeça
-- ===========================================================================
SELECT public.billing_apply_paid_subscription(
  '09000009-0000-4000-8000-000000000001'::uuid,
  (SELECT id FROM public.subscription_plans WHERE name = 'pro' LIMIT 1),
  'monthly', 'credit_card', 'pay_f9_2',
  9, 12000, 0, 12000, 0, 0, 0, NULL, 'asaas');

SELECT ok(
  (SELECT (public.billing_provision_existing_org('pay_f9_2') ->> 'active_until')::timestamptz
     > now() + interval '380 days'),
  '(RENOVA) renovar antes de vencer SOMA o ciclo ao que já foi pago — não joga fora os dias restantes');

SELECT is(
  (SELECT count(*)::int FROM public.subscription_provisionings
    WHERE organization_id = '09000009-0000-4000-8000-000000000001'),
  2,
  '(RENOVA) e cada cobrança deixa a sua linha no livro — dá para dizer por qual pagamento a org está ativa');

SELECT * FROM finish();
ROLLBACK;
