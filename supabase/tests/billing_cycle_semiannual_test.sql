-- supabase/tests/billing_cycle_semiannual_test.sql
--
-- `semiannual` é o nome canônico do ciclo semestral (SCRUM-289, §4.0 do laudo
-- do protótipo de checkout).
--
-- A PROVA É DE COMPORTAMENTO, NÃO DE ESTRUTURA. Não asserto que um CHECK existe
-- com tal texto — asserto o que o banco ACEITA e o que ele RECUSA. Um teste
-- estrutural passaria verde com dois CHECK contraditórios instalados, que é
-- exatamente o defeito que esta fatia conserta: cada constraint, lida sozinha,
-- parecia certa.
--
-- ESTADO ANTES DA MIGRATION 20270811150000: `org_subscriptions` carrega DOIS
-- CHECK sobre `billing_cycle` — o do baseline exigindo `semester` e o
-- `org_subscriptions_billing_cycle_valid` de 20270807000002 exigindo
-- `semiannual`. Predicados ANDados, então o domínio efetivo é a interseção
-- {monthly, annual}: NENHUM dos dois nomes do semestre entra. Este arquivo
-- nasce VERMELHO por isso, e é essa a demonstração.
--
-- Tudo roda em transação revertida; nenhuma linha sobrevive.
--
--   pg_prove --ext .sql -d "$DATABASE_URL" supabase/tests/billing_cycle_semiannual_test.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(8);

-- ---------------------------------------------------------------------------
-- Fixture mínima: uma org e um plano, só para satisfazer as FKs.
-- ---------------------------------------------------------------------------
-- Uma org POR asserção positiva. `org_subscriptions_one_current_per_org` só
-- admite uma assinatura corrente por organização, então reaproveitar a mesma org
-- faria a segunda inserção morrer por 23505 (chave duplicada) em vez de pelo
-- CHECK — o teste passaria a medir a coisa errada.
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-00000000c1c0', 'Org ciclo semiannual', 'org-ciclo-semiannual'),
  ('00000000-0000-0000-0000-00000000c1c1', 'Org ciclo pix',        'org-ciclo-pix'),
  ('00000000-0000-0000-0000-00000000c1c2', 'Org ciclo monthly',    'org-ciclo-monthly'),
  ('00000000-0000-0000-0000-00000000c1c3', 'Org ciclo annual',     'org-ciclo-annual');

INSERT INTO public.subscription_plans (id, name, display_name)
VALUES ('00000000-0000-0000-0000-00000000b1a0', 'plano-teste-ciclo', 'Plano do teste de ciclo');

-- ===========================================================================
-- 1-2. org_subscriptions: `semiannual` entra, `semester` não.
--
-- As duas asserções andam juntas de propósito. Aceitar `semiannual` sem recusar
-- `semester` trocaria ambiguidade por ambiguidade — o vocabulário voltaria a ter
-- dois nomes válidos, que é a doença, não a cura.
-- ===========================================================================

SELECT lives_ok(
  $$INSERT INTO public.org_subscriptions (organization_id, plan_id, billing_cycle)
    VALUES ('00000000-0000-0000-0000-00000000c1c0',
            '00000000-0000-0000-0000-00000000b1a0', 'semiannual')$$,
  'org_subscriptions ACEITA billing_cycle = semiannual (hoje recusa: dois CHECK contraditórios)'
);

SELECT throws_ok(
  $$INSERT INTO public.org_subscriptions (organization_id, plan_id, billing_cycle)
    VALUES ('00000000-0000-0000-0000-00000000c1c0',
            '00000000-0000-0000-0000-00000000b1a0', 'semester')$$,
  '23514',
  NULL,
  'org_subscriptions RECUSA billing_cycle = semester — um nome só para o ciclo'
);

-- ===========================================================================
-- 3-4. payment_history: mesmo par.
--
-- `status` = 'received' e não 'paid': o payment_history_status_check só admite
-- pending/confirmed/received/overdue/refunded/failed/cancelled — o vocabulário
-- dos eventos da Asaas. Com um status inválido, a asserção 4 passaria VERDE pelo
-- motivo errado: throws_ok casa o SQLSTATE 23514, e a violação viria do CHECK de
-- status, não do de ciclo. Asserção negativa que passa por dois motivos não
-- prova nada, e este arquivo existe justamente por causa de um CHECK que parecia
-- certo lido sozinho.
-- ===========================================================================

SELECT lives_ok(
  $$INSERT INTO public.payment_history (organization_id, amount, billing_cycle, status)
    VALUES ('00000000-0000-0000-0000-00000000c1c0', 100, 'semiannual', 'received')$$,
  'payment_history ACEITA billing_cycle = semiannual'
);

SELECT throws_ok(
  $$INSERT INTO public.payment_history (organization_id, amount, billing_cycle, status)
    VALUES ('00000000-0000-0000-0000-00000000c1c0', 100, 'semester', 'received')$$,
  '23514',
  NULL,
  'payment_history RECUSA billing_cycle = semester'
);

-- ===========================================================================
-- 5-6. A CONSEQUÊNCIA DE NEGÓCIO — a asserção que prova que o conserto serve ao
-- produto, e não só ao schema.
--
-- A regra comercial é "Pix só em semestral ou anual", gravada no schema
-- (org_subscriptions_pix_long_cycle_only) e no código (_shared/payments/
-- policy.ts). Com o semestral fora do domínio, metade dela estava morta: sobrava
-- só anual. Aqui ela volta inteira — e o par negativo prova que ela continua
-- valendo, ou seja, que a fatia abriu o ciclo certo sem afrouxar a regra.
-- ===========================================================================

SELECT lives_ok(
  $$INSERT INTO public.org_subscriptions (organization_id, plan_id, billing_cycle, payment_method)
    VALUES ('00000000-0000-0000-0000-00000000c1c1',
            '00000000-0000-0000-0000-00000000b1a0', 'semiannual', 'pix')$$,
  'pix + semiannual é inserível — a regra "Pix só em ciclo longo" volta a ter DOIS ciclos'
);

SELECT throws_ok(
  $$INSERT INTO public.org_subscriptions (organization_id, plan_id, billing_cycle, payment_method)
    VALUES ('00000000-0000-0000-0000-00000000c1c0',
            '00000000-0000-0000-0000-00000000b1a0', 'monthly', 'pix')$$,
  '23514',
  NULL,
  'pix + monthly continua RECUSADO — abrir o semestre não afrouxou a regra do Pix'
);

-- ===========================================================================
-- 7-8. Anti-regressão: os dois ciclos que sempre funcionaram continuam
-- funcionando. Sem isto, uma migration que trocasse o domínio inteiro por
-- {semiannual} passaria em tudo acima.
-- ===========================================================================

SELECT lives_ok(
  $$INSERT INTO public.org_subscriptions (organization_id, plan_id, billing_cycle)
    VALUES ('00000000-0000-0000-0000-00000000c1c2',
            '00000000-0000-0000-0000-00000000b1a0', 'monthly')$$,
  'monthly continua aceito'
);

SELECT lives_ok(
  $$INSERT INTO public.org_subscriptions (organization_id, plan_id, billing_cycle)
    VALUES ('00000000-0000-0000-0000-00000000c1c3',
            '00000000-0000-0000-0000-00000000b1a0', 'annual')$$,
  'annual continua aceito'
);

SELECT * FROM finish();

ROLLBACK;
