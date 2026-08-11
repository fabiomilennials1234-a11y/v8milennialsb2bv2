-- supabase/tests/organizations_plan_fk_test.sql
--
-- SCRUM-337 — `organizations.subscription_plan` passa a ser uma REFERÊNCIA ao
-- catálogo (`subscription_plans.name`), não uma segunda cópia dele escrita à
-- mão.
--
-- O defeito que motiva a fatia: o CHECK `organizations_subscription_plan_check`
-- listava 8 literais, e um deles — `basic` — NÃO existe em
-- `subscription_plans`. Org marcada como `basic` passava pelo CHECK e depois
-- caía no `COALESCE(sp.features, '{}')` do fallback de
-- `org_get_features_and_limits`: perdia TODAS as features em silêncio. Apagão,
-- não vazamento.
--
-- As asserções aqui são de COMPORTAMENTO — o que o banco aceita e o que
-- recusa. Nenhuma delas pergunta "existe uma constraint chamada X": esse tipo
-- de prova quebra em refactor sem defeito e, pior, passaria verde com o CHECK e
-- a FK vivos ao mesmo tempo. Quem mata essa ambiguidade é o SEAM 3: cadastrar
-- um plano NOVO no catálogo e atribuí-lo a uma org só é possível se o CHECK dos
-- 8 literais tiver MORRIDO.
--
-- Run: supabase start && bash supabase/tests/run.sh
-- Roda inteiro em transação revertida — não muta o banco.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

SET LOCAL role postgres;

-- ===========================================================================
-- Fixtures — o catálogo. Os planos são criados AQUI, não assumidos: a suíte não
-- pode depender de qual linha produção guarda hoje.
-- ===========================================================================
INSERT INTO public.subscription_plans (name, display_name) VALUES
  ('free',                    'Free (fixture SCRUM-337)'),
  ('scrum337-plano-novo',     'Plano novo (fixture SCRUM-337)'),
  ('scrum337-vai-renomear',   'Vai renomear (fixture SCRUM-337)'),
  ('scrum337-com-org',        'Tem org apontando (fixture SCRUM-337)'),
  ('scrum337-sem-org',        'Sem org apontando (fixture SCRUM-337)')
ON CONFLICT (name) DO NOTHING;

-- A premissa do ticket, dita em voz alta: `basic` é o nome que o CHECK
-- permitia e o catálogo nunca teve.
SELECT is(
  (SELECT count(*)::int FROM public.subscription_plans WHERE name = 'basic'),
  0,
  '(PREMISSA) `basic` NÃO existe no catálogo — era o furo do CHECK');

-- ===========================================================================
-- SEAM 1 — plano que EXISTE no catálogo grava.
-- Controle positivo: se este falhar, a FK está barrando o que deveria passar.
-- ===========================================================================
SELECT lives_ok(
  $$ INSERT INTO public.organizations (name, slug, subscription_plan)
     VALUES ('SCRUM-337 org plano existente', 'scrum337-org-existente', 'free') $$,
  '(SEAM 1) org com plano que EXISTE no catálogo é gravada');

-- ===========================================================================
-- SEAM 2 — plano AUSENTE do catálogo é recusado, nas DUAS portas de escrita.
-- Antes desta fatia, `basic` entrava por ser um dos 8 literais do CHECK.
-- ===========================================================================
SELECT throws_ok(
  $$ INSERT INTO public.organizations (name, slug, subscription_plan)
     VALUES ('SCRUM-337 org plano fantasma', 'scrum337-org-fantasma', 'basic') $$,
  '23503', NULL,
  '(SEAM 2a) INSERT de org com plano AUSENTE do catálogo é RECUSADO — fim do apagão silencioso do `basic`');

SELECT throws_ok(
  $$ UPDATE public.organizations SET subscription_plan = 'basic'
     WHERE slug = 'scrum337-org-existente' $$,
  '23503', NULL,
  '(SEAM 2b) UPDATE para plano AUSENTE do catálogo é RECUSADO — a porta do update não é mais frouxa que a do insert');

-- A org da SEAM 1 sobreviveu intacta às duas recusas.
SELECT is(
  (SELECT subscription_plan FROM public.organizations WHERE slug = 'scrum337-org-existente'),
  'free',
  '(SEAM 2c) a recusa não sujou a linha existente');

-- ===========================================================================
-- SEAM 3 — plano NOVO no catálogo é atribuível.
--
-- Esta é a asserção que prova que o CHECK MORREU, e não apenas que a FK
-- nasceu: `scrum337-plano-novo` não está entre os 8 literais que o CHECK
-- listava. Com os dois vivos ao mesmo tempo, esta linha falha.
-- ===========================================================================
SELECT lives_ok(
  $$ INSERT INTO public.organizations (name, slug, subscription_plan)
     VALUES ('SCRUM-337 org plano novo', 'scrum337-org-novo', 'scrum337-plano-novo') $$,
  '(SEAM 3) plano NOVO no catálogo é atribuível — prova que o CHECK dos 8 literais MORREU, não só que a FK nasceu');

-- ===========================================================================
-- SEAM 4 — renomear plano no catálogo leva as orgs junto (ON UPDATE CASCADE).
-- O nome é rótulo; a identidade é a linha do catálogo.
-- ===========================================================================
INSERT INTO public.organizations (name, slug, subscription_plan)
VALUES ('SCRUM-337 org do renomeado', 'scrum337-org-renomeado', 'scrum337-vai-renomear');

UPDATE public.subscription_plans
   SET name = 'scrum337-ja-renomeado'
 WHERE name = 'scrum337-vai-renomear';

SELECT is(
  (SELECT subscription_plan FROM public.organizations WHERE slug = 'scrum337-org-renomeado'),
  'scrum337-ja-renomeado',
  '(SEAM 4) renomear o plano no catálogo leva a org junto (CASCADE) — nenhuma org fica órfã por rename');

-- ===========================================================================
-- SEAM 5 — apagar plano que tem org é RECUSADO (ON DELETE RESTRICT).
--
-- Isolamento deliberado: `organizations.plan_id` JÁ tem FK contra
-- `subscription_plans(id)` (`organizations_plan_id_fkey`), e o gatilho
-- `trg_sync_org_plan_quotas` preenche esse plan_id resolvendo o NOME. Sem
-- desligar o gatilho, o DELETE seria recusado pela FK ANTIGA e o teste passaria
-- verde sem provar nada sobre a nova. Aqui a org nasce com plan_id NULO — e
-- isso é ASSERTADO — para que só a FK do nome possa recusar.
--
-- O isolamento é CONDICIONAL, e de propósito: a SCRUM-338 derruba a coluna
-- `plan_id` (morta, sem leitor) junto com o gatilho que a preenchia. Quando
-- isso acontecer o confundidor deixa de existir e não haverá nada a desligar —
-- mas um `ALTER TABLE ... DISABLE TRIGGER` fixo quebraria a suíte por ausência
-- do gatilho, e a leitura de `plan_id` nem sequer faria parse. Daí o DO block e
-- o `to_jsonb(o) ->> 'plan_id'`, que valem nos dois mundos e não obrigam
-- ninguém a mergear numa ordem específica.
-- ===========================================================================
DO $iso$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.organizations'::regclass
       AND tgname = 'trg_sync_org_plan_quotas'
       AND NOT tgisinternal
  ) THEN
    EXECUTE 'ALTER TABLE public.organizations DISABLE TRIGGER trg_sync_org_plan_quotas';
  END IF;
END
$iso$;

INSERT INTO public.organizations (name, slug, subscription_plan)
VALUES ('SCRUM-337 org do plano apagavel', 'scrum337-org-restrict', 'scrum337-com-org');

DO $iso$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.organizations'::regclass
       AND tgname = 'trg_sync_org_plan_quotas'
       AND NOT tgisinternal
  ) THEN
    EXECUTE 'ALTER TABLE public.organizations ENABLE TRIGGER trg_sync_org_plan_quotas';
  END IF;
END
$iso$;

SELECT ok(
  (SELECT (to_jsonb(o) ->> 'plan_id') IS NULL
     FROM public.organizations o WHERE o.slug = 'scrum337-org-restrict'),
  '(SEAM 5a) isolamento: a org do teste NÃO tem plan_id (nulo, ou coluna já derrubada pela SCRUM-338), então quem recusar o DELETE só pode ser a FK do NOME');

SELECT throws_ok(
  $$ DELETE FROM public.subscription_plans WHERE name = 'scrum337-com-org' $$,
  '23503', NULL,
  '(SEAM 5b) apagar plano que tem org é RECUSADO (RESTRICT) — SET NULL reproduziria o apagão, CASCADE apagaria as organizações');

SELECT is(
  (SELECT subscription_plan FROM public.organizations WHERE slug = 'scrum337-org-restrict'),
  'scrum337-com-org',
  '(SEAM 5c) a org sobreviveu ao DELETE recusado, com o plano intacto');

-- Controle positivo: plano SEM org sai limpo. A FK não trava o catálogo inteiro.
SELECT lives_ok(
  $$ DELETE FROM public.subscription_plans WHERE name = 'scrum337-sem-org' $$,
  '(SEAM 5d) plano SEM org apontando pode ser apagado — o RESTRICT não é um cadeado no catálogo');

-- ===========================================================================
-- SEAM 6 — NULO continua permitido, e continua sendo o que a coluna guarda
-- quando ninguém a informa.
--
-- `NOT NULL` quebraria `create_org_sandbox` e o edge `test-workflow-system`,
-- que inserem org sem plano; um `DEFAULT` faria a org nascer com um plano que
-- ninguém escolheu. A omissão da coluna no INSERT prova as duas coisas de uma
-- vez: se houvesse DEFAULT, o valor lido não seria NULO.
-- ===========================================================================
SELECT lives_ok(
  $$ INSERT INTO public.organizations (name, slug)
     VALUES ('SCRUM-337 org sem plano', 'scrum337-org-sem-plano') $$,
  '(SEAM 6a) org SEM plano é gravada — create_org_sandbox e test-workflow-system continuam de pé');

SELECT ok(
  (SELECT subscription_plan IS NULL FROM public.organizations WHERE slug = 'scrum337-org-sem-plano'),
  '(SEAM 6b) a coluna omitida fica NULA — sem NOT NULL e sem DEFAULT pendurando plano que ninguém escolheu');

SELECT lives_ok(
  $$ UPDATE public.organizations SET subscription_plan = NULL
     WHERE slug = 'scrum337-org-existente' $$,
  '(SEAM 6c) zerar o plano de uma org existente continua permitido');

SELECT * FROM finish();
ROLLBACK;
