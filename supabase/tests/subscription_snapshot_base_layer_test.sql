-- supabase/tests/subscription_snapshot_base_layer_test.sql
--
-- PRD #1393 — fatias 3 e 4. Prova o contrato de #1380/#1381/#1382 contra o schema real.
--
-- O que está sendo protegido aqui é o caminho mais quente do produto:
-- `org_get_features_and_limits` é atravessada por 97 organizações a cada carregamento de
-- tela, e esta mudança troca a camada BASE dela. Um erro aqui tira acesso de cliente
-- pagante em toda a base ao mesmo tempo.
--
-- Cobre:
--   (a) estrutura e invariantes do snapshot
--   (b) append-only — uma vigente por org, histórico permitido
--   (c) resolução SEM snapshot (fallback pro plano, permanente)
--   (d) resolução COM snapshot (grandfathering: mexer no plano não move o cliente)
--   (e) camadas de cima intactas (organization_features, org_quotas)
--   (f) chave não vendável ainda resolve por default_enabled com snapshot presente
--   (g) motor de preço — cascata multiplicativa, formas de preço, política de Pix
--   (h) grants do motor de preço
--
-- Run:
--   supabase start && bash supabase/tests/run.sh
-- or:
--   pg_prove -d "$DATABASE_URL" supabase/tests/subscription_snapshot_base_layer_test.sql
--
-- Roda inteiro dentro de transação revertida — não muta o banco.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(39);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE _ids AS
SELECT
  '11111111-1111-1111-1111-111111111111'::uuid AS org_snap,
  '22222222-2222-2222-2222-222222222222'::uuid AS org_plain,
  '33333333-3333-3333-3333-333333333333'::uuid AS plan_a;

INSERT INTO public.subscription_plans
  (id, name, display_name, features, limits,
   base_price_monthly, price_monthly, included_users, min_users, extra_user_price,
   discount_semester_pct, discount_annual_pct, is_active)
SELECT plan_a, 'basic', 'Plano de Teste',
       '{"chat": true, "copilot": false}'::jsonb,
       '{"max_leads": 100, "max_users": 4}'::jsonb,
       1997, 1997, 3, 3, 120, 10, 15, true
FROM _ids;

-- Catálogo próprio: o teste não pode depender de dado semeado, senão passa na máquina de
-- quem tem a base de produção e falha em `db reset` limpo.
INSERT INTO public.feature_catalog (key, name, description, category, default_enabled, feature_type, icon, is_sellable)
VALUES ('chat',    'Chat',    'fixture', 'modules', true,  'boolean', 'Zap', true),
       ('copilot', 'Copilot', 'fixture', 'modules', false, 'boolean', 'Bot', true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.organizations (id, name, slug, subscription_plan)
SELECT org_snap, '__test_org_snapshot__', '__test-org-snapshot__', 'basic' FROM _ids;
INSERT INTO public.organizations (id, name, slug, subscription_plan)
SELECT org_plain, '__test_org_plain__', '__test-org-plain__', 'basic' FROM _ids;

-- ---------------------------------------------------------------------------
-- (a) Estrutura e invariantes
-- ---------------------------------------------------------------------------

SELECT has_column('public', 'org_subscriptions', 'features',
  '(a) org_subscriptions.features existe');
SELECT has_column('public', 'org_subscriptions', 'limits',
  '(a) org_subscriptions.limits existe');
SELECT hasnt_column('public', 'org_subscriptions', 'addon_turbo_count',
  '(a) addon_turbo_count foi dropada — campo morto em tabela vazia (#1380)');
SELECT col_type_is('public', 'org_subscriptions', 'final_amount_cents', 'integer',
  '(a) dinheiro é centavo inteiro, nunca numérico de ponto flutuante');

-- Pix mensal é recusado pelo schema, não só pelo código.
SELECT throws_ok(
  format($$INSERT INTO public.org_subscriptions
            (organization_id, plan_id, billing_cycle, payment_method)
          VALUES (%L, %L, 'monthly', 'pix')$$,
         (SELECT org_plain FROM _ids), (SELECT plan_a FROM _ids)),
  '23514',
  NULL,
  '(a) pix mensal é bloqueado por CHECK — decisão #5 gravada no schema');

-- Desconto manual sem motivo é buraco de receita invisível.
SELECT throws_ok(
  format($$INSERT INTO public.org_subscriptions
            (organization_id, plan_id, billing_cycle, manual_discount_cents)
          VALUES (%L, %L, 'monthly', 5000)$$,
         (SELECT org_plain FROM _ids), (SELECT plan_a FROM _ids)),
  '23514',
  NULL,
  '(a) desconto manual sem motivo é bloqueado por CHECK (#1381)');

SELECT lives_ok(
  format($$INSERT INTO public.org_subscriptions
            (organization_id, plan_id, billing_cycle, payment_method)
          VALUES (%L, %L, 'annual', 'pix')$$,
         (SELECT org_plain FROM _ids), (SELECT plan_a FROM _ids)),
  '(a) pix anual é aceito');

-- ---------------------------------------------------------------------------
-- (b) Append-only
-- ---------------------------------------------------------------------------

SELECT throws_ok(
  format($$INSERT INTO public.org_subscriptions (organization_id, plan_id, billing_cycle)
          VALUES (%L, %L, 'monthly')$$,
         (SELECT org_plain FROM _ids), (SELECT plan_a FROM _ids)),
  '23505',
  NULL,
  '(b) duas assinaturas VIGENTES na mesma org são bloqueadas');

UPDATE public.org_subscriptions
   SET cancelled_at = now()
 WHERE organization_id = (SELECT org_plain FROM _ids);

SELECT lives_ok(
  format($$INSERT INTO public.org_subscriptions (organization_id, plan_id, billing_cycle)
          VALUES (%L, %L, 'monthly')$$,
         (SELECT org_plain FROM _ids), (SELECT plan_a FROM _ids)),
  '(b) versão nova é aceita depois da anterior virar histórico');

SELECT is(
  (SELECT count(*)::int FROM public.org_subscriptions
    WHERE organization_id = (SELECT org_plain FROM _ids)),
  2,
  '(b) o histórico permanece — a versão antiga não é apagada');

-- Limpa para os testes de resolução.
DELETE FROM public.org_subscriptions WHERE organization_id = (SELECT org_plain FROM _ids);

-- ---------------------------------------------------------------------------
-- (c) Resolução SEM snapshot — fallback pro plano
-- ---------------------------------------------------------------------------

SELECT is(
  (public.org_get_features_and_limits((SELECT org_plain FROM _ids)) -> 'features' ->> 'chat'),
  'true',
  '(c) sem snapshot, feature vem do plano');

SELECT is(
  (public.org_get_features_and_limits((SELECT org_plain FROM _ids)) -> 'features' ->> 'copilot'),
  'false',
  '(c) sem snapshot, feature desligada no plano continua desligada');

SELECT is(
  (public.org_get_features_and_limits((SELECT org_plain FROM _ids)) -> 'limits' ->> 'max_leads'),
  '100',
  '(c) sem snapshot, limite vem do plano');

SELECT is(
  (public.org_get_features_and_limits((SELECT org_plain FROM _ids)) ->> 'plan_name'),
  'basic',
  '(c) sem snapshot, plan_name é o do plano da org');

-- ---------------------------------------------------------------------------
-- (d) Resolução COM snapshot — grandfathering
-- ---------------------------------------------------------------------------

INSERT INTO public.org_subscriptions
  (organization_id, plan_id, billing_cycle, features, limits)
SELECT org_snap, plan_a, 'annual',
       '{"chat": false, "copilot": true}'::jsonb,
       '{"max_leads": 999, "max_users": 7}'::jsonb
FROM _ids;

SELECT is(
  (public.org_get_features_and_limits((SELECT org_snap FROM _ids)) -> 'features' ->> 'copilot'),
  'true',
  '(d) com snapshot, a feature vendida vence o plano');

SELECT is(
  (public.org_get_features_and_limits((SELECT org_snap FROM _ids)) -> 'features' ->> 'chat'),
  'false',
  '(d) com snapshot, feature NÃO vendida fica desligada mesmo ligada no plano');

SELECT is(
  (public.org_get_features_and_limits((SELECT org_snap FROM _ids)) -> 'limits' ->> 'max_leads'),
  '999',
  '(d) com snapshot, o limite vendido vence o do plano');

-- O teste que dá sentido ao snapshot: mexer no catálogo não move quem já comprou.
UPDATE public.subscription_plans
   SET features = '{"chat": true, "copilot": true}'::jsonb,
       limits   = '{"max_leads": 1, "max_users": 1}'::jsonb
 WHERE id = (SELECT plan_a FROM _ids);

SELECT is(
  (public.org_get_features_and_limits((SELECT org_snap FROM _ids)) -> 'limits' ->> 'max_leads'),
  '999',
  '(d) GRANDFATHERING: mudar a tabela de planos não reprecifica quem tem snapshot');

SELECT is(
  (public.org_get_features_and_limits((SELECT org_plain FROM _ids)) -> 'limits' ->> 'max_leads'),
  '1',
  '(d) e quem NÃO tem snapshot acompanha o plano, como sempre acompanhou');

-- ---------------------------------------------------------------------------
-- (e) Camadas de cima seguem intactas
-- ---------------------------------------------------------------------------

INSERT INTO public.organization_features (organization_id, feature_key, enabled)
SELECT org_snap, 'chat', true FROM _ids;

SELECT is(
  (public.org_get_features_and_limits((SELECT org_snap FROM _ids)) -> 'features' ->> 'chat'),
  'true',
  '(e) organization_features continua vencendo o snapshot');

-- effective_limit é coluna GERADA (plan_base + purchased_addons + admin_adjustment): 7+0+5.
-- É o que faz a decisão de #1382 funcionar — o snapshot escreve plan_base e o efetivo
-- recalcula sozinho, sem ninguém sincronizar nada.
-- ON CONFLICT porque criar organização já dispara a semeadura de org_quotas a partir do
-- plano — a linha existe antes de o teste chegar aqui.
INSERT INTO public.org_quotas (organization_id, resource_key, plan_base, purchased_addons, admin_adjustment)
SELECT org_snap, 'max_users', 7, 0, 5 FROM _ids
ON CONFLICT (organization_id, resource_key) DO UPDATE
  SET plan_base = 7, purchased_addons = 0, admin_adjustment = 5;

SELECT is(
  (public.org_get_features_and_limits((SELECT org_snap FROM _ids)) -> 'limits' ->> 'max_users'),
  '12',
  '(e) org_quotas.effective_limit continua vencendo o snapshot');

UPDATE public.organizations
   SET limit_overrides = '{"max_documents_per_agent": 42}'::jsonb
 WHERE id = (SELECT org_snap FROM _ids);

SELECT is(
  (public.org_get_features_and_limits((SELECT org_snap FROM _ids)) -> 'limits' ->> 'max_documents_per_agent'),
  '42',
  '(e) limit_overrides continua valendo por cima do snapshot');

-- ---------------------------------------------------------------------------
-- (f) Chave não vendável com snapshot presente
-- ---------------------------------------------------------------------------
--
-- O snapshot é exaustivo apenas sobre is_sellable. Se o preenchimento por default_enabled
-- não alcançasse as não vendáveis, toda flag de rollout sumiria para org com snapshot.

INSERT INTO public.feature_catalog (key, name, description, category, default_enabled, feature_type, icon, is_sellable)
VALUES ('__test_rollout__', 'Rollout de teste', 'x', 'advanced', true, 'boolean', 'Zap', false);

SELECT is(
  (public.org_get_features_and_limits((SELECT org_snap FROM _ids)) -> 'features' ->> '__test_rollout__'),
  'true',
  '(f) chave NÃO vendável resolve por default_enabled mesmo com snapshot');

INSERT INTO public.feature_catalog (key, name, description, category, default_enabled, feature_type, icon, is_sellable)
VALUES ('__test_sellable__', 'Vendável de teste', 'x', 'advanced', true, 'boolean', 'Zap', true);

SELECT is(
  (public.org_get_features_and_limits((SELECT org_snap FROM _ids)) -> 'features' ->> '__test_sellable__'),
  'true',
  '(f) chave vendável ausente do snapshot ainda cai em default_enabled — o backfill é que a torna exaustiva');

-- ---------------------------------------------------------------------------
-- (g) Motor de preço
-- ---------------------------------------------------------------------------

SELECT has_function('public', 'billing_quote_price',
  ARRAY['uuid', 'integer', 'text', 'text', 'text', 'integer'],
  '(g) billing_quote_price existe');

-- Base 1997 com 3 assentos inclusos, +2 extras a 120 = 2237,00
SELECT is(
  (public.billing_quote_price((SELECT plan_a FROM _ids), 5, 'monthly') ->> 'subtotal_cents')::int,
  223700,
  '(g) base + assentos extras: 1997 + 2x120 = R$2.237,00');

SELECT is(
  (public.billing_quote_price((SELECT plan_a FROM _ids), 1, 'monthly') ->> 'seats')::int,
  3,
  '(g) min_users é respeitado — pedir 1 assento entrega o piso do plano');

-- Cascata: 223700 -15% = 190145
SELECT is(
  (public.billing_quote_price((SELECT plan_a FROM _ids), 5, 'annual') ->> 'final_amount_cents')::int,
  190145,
  '(g) desconto de ciclo anual aplica sobre o subtotal');

SELECT is(
  (public.billing_quote_price((SELECT plan_a FROM _ids), 5, 'annual') ->> 'charge_cents')::int,
  190145 * 12,
  '(g) charge_cents é o mensal vezes os meses do ciclo');

-- Cascata multiplicativa com cupom: 223700 -15% = 190145; -35% = 123594
INSERT INTO public.coupons (code, discount_pct, applies_to, is_active)
VALUES ('__TEST35__', 35, ARRAY[]::text[], true);

SELECT is(
  (public.billing_quote_price((SELECT plan_a FROM _ids), 5, 'annual', NULL, '__TEST35__') ->> 'final_amount_cents')::int,
  123594,
  '(g) CASCATA: cupom aplica sobre o que sobrou do desconto de ciclo, não sobre o subtotal');

-- Aditivo daria 223700 * 0.50 = 111850. Provar que NÃO é isso é o ponto do teste.
SELECT isnt(
  (public.billing_quote_price((SELECT plan_a FROM _ids), 5, 'annual', NULL, '__TEST35__') ->> 'final_amount_cents')::int,
  111850,
  '(g) descontos NÃO são somados — aditivo não tem piso e chegaria a zero');

SELECT is(
  (public.billing_quote_price((SELECT plan_a FROM _ids), 5, 'monthly', NULL, NULL, 100000) ->> 'manual_discount_cents')::int,
  123700,
  '(g) override manual registra o delta contra o calculado');

SELECT throws_ok(
  format($$SELECT public.billing_quote_price(%L, 5, 'monthly', 'pix')$$, (SELECT plan_a FROM _ids)),
  '23514',
  NULL,
  '(g) pix mensal é recusado ANTES de calcular — valor devolvido vira proposta enviada');

SELECT throws_ok(
  format($$SELECT public.billing_quote_price(%L, 5, 'quinzenal')$$, (SELECT plan_a FROM _ids)),
  '23514',
  NULL,
  '(g) ciclo inválido é recusado');

-- Puro por assento: 5 x 697 = 3485,00, sem base separada
UPDATE public.subscription_plans
   SET price_per_user_monthly = 697, base_price_monthly = NULL, included_users = 0, min_users = 5
 WHERE id = (SELECT plan_a FROM _ids);

SELECT is(
  (public.billing_quote_price((SELECT plan_a FROM _ids), 5, 'monthly') ->> 'subtotal_cents')::int,
  348500,
  '(g) forma por assento: 5 x R$697 = R$3.485,00');

SELECT is(
  (public.billing_quote_price((SELECT plan_a FROM _ids), 5, 'monthly') ->> 'base_cents')::int,
  0,
  '(g) forma por assento não tem base separada');

-- ---------------------------------------------------------------------------
-- (h) Grants do motor de preço
-- ---------------------------------------------------------------------------
--
-- O preço nasce no servidor e nenhum caminho vindo do browser o alcança (#1381).

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public.billing_quote_price(uuid, integer, text, text, text, integer)', 'EXECUTE'),
  '(h) authenticated NÃO pode executar o motor de preço');

SELECT ok(
  NOT has_function_privilege('anon',
    'public.billing_quote_price(uuid, integer, text, text, text, integer)', 'EXECUTE'),
  '(h) anon NÃO pode executar o motor de preço');

SELECT ok(
  has_function_privilege('service_role',
    'public.billing_quote_price(uuid, integer, text, text, text, integer)', 'EXECUTE'),
  '(h) service_role pode — é a edge function do link que chama, e ela é quem autoriza');

SELECT * FROM finish();

ROLLBACK;
