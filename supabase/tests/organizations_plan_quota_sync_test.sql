-- supabase/tests/organizations_plan_quota_sync_test.sql
--
-- SCRUM-338 — a cota da organização segue o PLANO VIGENTE, resolvido por NOME.
--
-- O defeito que este arquivo tranca já mordeu produção em 11/08: 8 organizações
-- pagantes ficaram com a cota do plano 'free' (max_users 2 em vez de 5).
-- Causa: `trg_sync_org_plan_quotas` disparava em UPDATE OF subscription_plan,
-- plan_id, mas `sync_org_plan_quotas()` só resolvia `organizations.plan_id`
-- QUANDO ELE ERA NULO. O Master troca o plano escrevendo o TEXTO
-- (`subscription_plan`); `plan_id` ficava velho; e a sincronia de
-- `org_quotas.plan_base` lia justamente por `plan_id`. Cota do plano ERRADO.
--
-- A porta exercida aqui é a REAL: `UPDATE public.organizations SET
-- subscription_plan = ...`, deixando o gatilho agir. Chamar
-- `sync_org_plan_quotas()` direto provaria outra coisa — provaria que a função
-- faz o que a função faz, não que a troca de plano chega na cota.
--
-- As quatro costuras (acordadas com o CTO):
--   1. trocar `subscription_plan` move `org_quotas.plan_base` para os limites do
--      plano NOVO;                                    (NASCE VERMELHO)
--   2. `admin_adjustment` SOBREVIVE à sincronização (há clientes com ajuste
--      manual em produção: Zimermann +4, Goletric +2, Villa Branca +1);
--   3. `purchased_addons` sobrevive;
--   4. a coluna `organizations.plan_id` não existe mais. (NASCE VERMELHO)
--
-- Run: supabase db reset && bash supabase/tests/run.sh
-- Roda inteiro em transação revertida.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- ===========================================================================
-- (STRUCT) a coluna morta e o gatilho que a escutava
-- ===========================================================================
SELECT hasnt_column(
  'public', 'organizations', 'plan_id',
  '(STRUCT) organizations.plan_id NÃO existe — a cota resolve por nome');

SELECT ok(
  (SELECT pg_get_triggerdef(oid) FROM pg_trigger
    WHERE tgname = 'trg_sync_org_plan_quotas'
      AND tgrelid = 'public.organizations'::regclass) NOT LIKE '%plan_id%',
  '(STRUCT) trg_sync_org_plan_quotas não escuta mais plan_id');

SELECT ok(
  (SELECT pg_get_triggerdef(oid) FROM pg_trigger
    WHERE tgname = 'trg_sync_org_plan_quotas'
      AND tgrelid = 'public.organizations'::regclass) LIKE '%UPDATE OF subscription_plan%',
  '(STRUCT) trg_sync_org_plan_quotas continua escutando subscription_plan');

-- É o UNIQUE que torna a resolução por nome determinística. Sem ele, `WHERE
-- name = NEW.subscription_plan` devolveria mais de uma linha e a função
-- levantaria 21000 no meio de uma escrita quente. A função não desempata
-- porque o schema proíbe o empate — esta asserção é o que ancora essa escolha.
SELECT col_is_unique(
  'public', 'subscription_plans', 'name',
  '(STRUCT) subscription_plans.name é UNIQUE — resolução por nome é determinística');

-- ===========================================================================
-- Fixtures — os planos
--
-- `subscription_plans` não é semeado por migration nenhuma: em base local ela
-- nasce vazia. Mas em base clonada de produção os nomes já existem — por isso
-- o fixture ATUALIZA quem existe e só INSERE quem falta. Assim os limites são
-- os mesmos independente de qual linha a resolução por nome escolher.
-- ===========================================================================
UPDATE public.subscription_plans
   SET limits = jsonb_build_object(
         'max_users', 2, 'max_whatsapp_instances', 1, 'max_copilot_agents', 1)
 WHERE name = 'free';

INSERT INTO public.subscription_plans (name, display_name, limits)
SELECT 'free', 'Free (fixture SCRUM-338)',
       jsonb_build_object('max_users', 2, 'max_whatsapp_instances', 1, 'max_copilot_agents', 1)
 WHERE NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE name = 'free');

UPDATE public.subscription_plans
   SET limits = jsonb_build_object(
         'max_users', 5, 'max_whatsapp_instances', 3, 'max_copilot_agents', 4)
 WHERE name = 'pro';

INSERT INTO public.subscription_plans (name, display_name, limits)
SELECT 'pro', 'Pro (fixture SCRUM-338)',
       jsonb_build_object('max_users', 5, 'max_whatsapp_instances', 3, 'max_copilot_agents', 4)
 WHERE NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE name = 'pro');

-- -1 = ILIMITADO. Vai provar que o valor atravessa a sincronização inteiro,
-- e que `effective_limit` (coluna GERADA) não o soma com os deltas.
UPDATE public.subscription_plans
   SET limits = jsonb_build_object(
         'max_users', -1, 'max_whatsapp_instances', -1, 'max_copilot_agents', -1)
 WHERE name = 'enterprise';

INSERT INTO public.subscription_plans (name, display_name, limits)
SELECT 'enterprise', 'Enterprise (fixture SCRUM-338)',
       jsonb_build_object('max_users', -1, 'max_whatsapp_instances', -1, 'max_copilot_agents', -1)
 WHERE NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE name = 'enterprise');

-- Plano com limites PARCIAIS. `limits` é jsonb DEFAULT '{}' NOT NULL, entao
-- catalogar plano sem preencher tudo é o caminho fácil, não o exótico.
UPDATE public.subscription_plans
   SET limits = jsonb_build_object('max_users', 7)
 WHERE name = 'starter';

INSERT INTO public.subscription_plans (name, display_name, limits)
SELECT 'starter', 'Starter (fixture SCRUM-338, limites parciais)',
       jsonb_build_object('max_users', 7)
 WHERE NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE name = 'starter');

-- Plano com ZERO explícito nos três — o oposto da ausência.
UPDATE public.subscription_plans
   SET limits = jsonb_build_object(
         'max_users', 0, 'max_whatsapp_instances', 0, 'max_copilot_agents', 0)
 WHERE name = 'basic';

INSERT INTO public.subscription_plans (name, display_name, limits)
SELECT 'basic', 'Basic (fixture SCRUM-338, zeros explícitos)',
       jsonb_build_object('max_users', 0, 'max_whatsapp_instances', 0, 'max_copilot_agents', 0)
 WHERE NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE name = 'basic');

-- ===========================================================================
-- Fixtures — a organização, provisionada pela porta real (AFTER INSERT)
-- ===========================================================================
INSERT INTO public.organizations (id, name, slug, subscription_plan)
VALUES ('5c2c8338-0000-4000-8000-000000000001', 'Org SCRUM-338', 'org-scrum-338', 'free');

-- CONTROLE POSITIVO. Sem isto, a costura 1 passaria verde por dois motivos —
-- porque a sincronia funciona, ou porque a linha nunca existiu.
SELECT is(
  (SELECT plan_base FROM public.org_quotas
    WHERE organization_id = '5c2c8338-0000-4000-8000-000000000001'
      AND resource_key = 'max_users'),
  2,
  '(CONTROLE) INSERT provisiona a cota do plano free (max_users 2)');

-- Os deltas manuais que produção carrega e que a sincronização não pode comer.
UPDATE public.org_quotas
   SET admin_adjustment = 3, purchased_addons = 2
 WHERE organization_id = '5c2c8338-0000-4000-8000-000000000001'
   AND resource_key = 'max_users';

-- ===========================================================================
-- (ATO) o Master troca o plano escrevendo o TEXTO — o caminho de produção
-- ===========================================================================
UPDATE public.organizations
   SET subscription_plan = 'pro'
 WHERE id = '5c2c8338-0000-4000-8000-000000000001';

-- (COSTURA 1) — o defeito que vazou para produção.
SELECT is(
  (SELECT plan_base FROM public.org_quotas
    WHERE organization_id = '5c2c8338-0000-4000-8000-000000000001'
      AND resource_key = 'max_users'),
  5,
  '(COSTURA 1) trocar subscription_plan free→pro leva plan_base para 5 — o furo das 8 orgs pagantes');

SELECT is(
  (SELECT plan_base FROM public.org_quotas
    WHERE organization_id = '5c2c8338-0000-4000-8000-000000000001'
      AND resource_key = 'max_whatsapp_instances'),
  3,
  '(COSTURA 1) max_whatsapp_instances acompanha o plano novo');

SELECT is(
  (SELECT plan_base FROM public.org_quotas
    WHERE organization_id = '5c2c8338-0000-4000-8000-000000000001'
      AND resource_key = 'max_copilot_agents'),
  4,
  '(COSTURA 1) max_copilot_agents acompanha o plano novo');

-- (COSTURA 2) e (COSTURA 3) — os deltas são do cliente, não do plano.
SELECT is(
  (SELECT admin_adjustment FROM public.org_quotas
    WHERE organization_id = '5c2c8338-0000-4000-8000-000000000001'
      AND resource_key = 'max_users'),
  3,
  '(COSTURA 2) admin_adjustment sobrevive à sincronização (Zimermann +4 não evapora)');

SELECT is(
  (SELECT purchased_addons FROM public.org_quotas
    WHERE organization_id = '5c2c8338-0000-4000-8000-000000000001'
      AND resource_key = 'max_users'),
  2,
  '(COSTURA 3) purchased_addons sobrevive à sincronização');

SELECT is(
  (SELECT effective_limit FROM public.org_quotas
    WHERE organization_id = '5c2c8338-0000-4000-8000-000000000001'
      AND resource_key = 'max_users'),
  10,
  '(COSTURA 2+3) effective_limit = 5 + 2 + 3');

-- ===========================================================================
-- (ILIMITADO) -1 atravessa inteiro e não vira 4 ao somar os deltas
-- ===========================================================================
UPDATE public.organizations
   SET subscription_plan = 'enterprise'
 WHERE id = '5c2c8338-0000-4000-8000-000000000001';

SELECT is(
  (SELECT plan_base FROM public.org_quotas
    WHERE organization_id = '5c2c8338-0000-4000-8000-000000000001'
      AND resource_key = 'max_users'),
  -1,
  '(ILIMITADO) plan_base = -1 (não COALESCE para 0, não soma)');

SELECT is(
  (SELECT effective_limit FROM public.org_quotas
    WHERE organization_id = '5c2c8338-0000-4000-8000-000000000001'
      AND resource_key = 'max_users'),
  -1,
  '(ILIMITADO) effective_limit continua -1 mesmo com deltas manuais na linha');

-- ===========================================================================
-- (VOLTA) descer de plano também move a cota — não é caminho de só-subir
-- ===========================================================================
UPDATE public.organizations
   SET subscription_plan = 'free'
 WHERE id = '5c2c8338-0000-4000-8000-000000000001';

SELECT is(
  (SELECT plan_base FROM public.org_quotas
    WHERE organization_id = '5c2c8338-0000-4000-8000-000000000001'
      AND resource_key = 'max_users'),
  2,
  '(VOLTA) enterprise→free devolve plan_base para 2');

-- ===========================================================================
-- (AUSENTE) chave que não está em `limits` significa "não mexer", não "zero"
--
-- `subscription_plans.limits` é `jsonb DEFAULT '{}' NOT NULL`, então plano
-- cadastrado sem preencher os limites é o caminho FÁCIL, não o exótico — e
-- depois do SCRUM-337 catalogar plano virou operação de dado, sem migration.
-- Se a ausência virasse 0, uma org pagante perderia a capacidade de adicionar
-- usuário em silêncio: a mesma forma do incidente de 11/08, por outra porta.
-- ===========================================================================
UPDATE public.organizations
   SET subscription_plan = 'starter'
 WHERE id = '5c2c8338-0000-4000-8000-000000000001';

SELECT is(
  (SELECT plan_base FROM public.org_quotas
    WHERE organization_id = '5c2c8338-0000-4000-8000-000000000001'
      AND resource_key = 'max_users'),
  7,
  '(AUSENTE) a chave PRESENTE no plano parcial sincroniza normalmente');

SELECT is(
  (SELECT plan_base FROM public.org_quotas
    WHERE organization_id = '5c2c8338-0000-4000-8000-000000000001'
      AND resource_key = 'max_whatsapp_instances'),
  1,
  '(AUSENTE) chave fora de limits NÃO rebaixa a cota existente para 0');

SELECT is(
  (SELECT plan_base FROM public.org_quotas
    WHERE organization_id = '5c2c8338-0000-4000-8000-000000000001'
      AND resource_key = 'max_copilot_agents'),
  1,
  '(AUSENTE) idem para o segundo recurso ausente — o pulo é por recurso');

-- ===========================================================================
-- (ZERO) e o zero EXPLÍCITO continua sendo zero — ausência ≠ 0
--
-- Sem esta, o pulo do (AUSENTE) passaria verde por dois motivos: porque a
-- ausência é respeitada, ou porque a função parou de escrever zero nenhum.
-- ===========================================================================
UPDATE public.organizations
   SET subscription_plan = 'basic'
 WHERE id = '5c2c8338-0000-4000-8000-000000000001';

SELECT is(
  (SELECT plan_base FROM public.org_quotas
    WHERE organization_id = '5c2c8338-0000-4000-8000-000000000001'
      AND resource_key = 'max_users'),
  0,
  '(ZERO) chave presente com 0 grava 0 — ausência e zero não colapsam');

SELECT is(
  (SELECT effective_limit FROM public.org_quotas
    WHERE organization_id = '5c2c8338-0000-4000-8000-000000000001'
      AND resource_key = 'max_users'),
  5,
  '(ZERO) effective_limit = GREATEST(0 + 2 + 3, 0) — os deltas do cliente seguram');

-- ===========================================================================
-- (NULO) o único ramo que produção exercita e o teste não via
--
-- `create_org_sandbox` e o edge `test-workflow-system` inserem organização SEM
-- plano. O gatilho AFTER INSERT dispara e a função sai cedo. Comportamento não
-- muda com este PR — mas é ramo vivo, e ramo vivo tem asserção.
-- ===========================================================================
SELECT lives_ok(
  $$ UPDATE public.organizations SET subscription_plan = NULL
      WHERE id = '5c2c8338-0000-4000-8000-000000000001' $$,
  '(NULO) organização sem plano não derruba a escrita');

SELECT is(
  (SELECT plan_base FROM public.org_quotas
    WHERE organization_id = '5c2c8338-0000-4000-8000-000000000001'
      AND resource_key = 'max_users'),
  0,
  '(NULO) sem plano, a cota fica como estava — não zera, não some');

-- NOTA sobre o caso "nome sem linha no catálogo": `sync_org_plan_quotas()`
-- retorna sem tocar a cota quando a resolução por nome não acha plano —
-- sincronizar para "limites nulos" rebaixaria a organização a zero em
-- silêncio. Esse caso NÃO é exercido aqui de propósito: o SCRUM-337
-- (20270811000000) troca o CHECK de literais de `subscription_plan` por uma FK
-- para `subscription_plans(name)`, e a partir dele um nome fora do catálogo
-- não passa mais no INSERT/UPDATE — a asserção viraria violação de FK. A
-- guarda fica na função como fail-safe (e cobre `subscription_plan` NULO).

SELECT * FROM finish();
ROLLBACK;
