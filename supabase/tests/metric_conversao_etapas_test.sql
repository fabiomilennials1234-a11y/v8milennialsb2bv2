-- supabase/tests/metric_conversao_etapas_test.sql
--
-- SCRUM-316: conversão entre etapas por COORTE.
--   negocios_coorte_convertidos ÷ negocios_coorte_origem
--
-- A decisão que esta suíte guarda (CTO, 2026-08-20): conversão é FLUXO POR
-- COORTE, não estoque nem fluxo-por-janela. Traduzido em asserção:
--
--   (CT) a COORTE é quem CHEGOU à origem na janela — não quem está lá agora
--        (estoque) e não quem entrou no destino na janela (fluxo/janela).
--   (CB) a coorte é seguida ATÉ O DESFECHO, inclusive fora da janela. É o que
--        separa esta conta da fluxo/janela: quem entrou em agosto e fechou em
--        setembro CONTA. Sem isto a taxa seria sistematicamente subestimada.
--   (RE) REENTRADA não recria coorte. `min(occurred_at)` é a primeira chegada;
--        quem já estava na etapa antes da janela fica fora, mesmo voltando.
--   (MA) MATURAÇÃO: `em_aberto` conta quem não chegou ao destino E não teve
--        desfecho. É o rótulo que a janela mostra — a decisão foi ROTULAR, não
--        corrigir. Quem foi para 'perdido' NÃO é maturação: já respondeu.
--   (RZ) a razão vive em [0, 100] POR CONSTRUÇÃO — numerador é subconjunto do
--        denominador. É a mesma disciplina de `taxa_qualidade`.
--   (D0) coorte vazia é AUSÊNCIA (`value null` + `empty_reason`), nunca 0%.
--        0 ÷ 0 mostrado como 0% seria uma conversão que ninguém teve.
--   (ER) as duas etapas são OBRIGATÓRIAS e falham ALTO (22023). Devolver 0 sem
--        elas seria um zero que parece resposta.
--   (XO) isolamento cross-org, nas duas pontas: autorização e filtro.
--   (GR) a função da coorte é INTERNA — anon e authenticated não a executam.
--   (AL) a allowlist da árvore ganhou as duas chaves, e SÓ elas.
--
-- Roda inteiro em transação revertida — não muta o banco.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;
-- Desarma triggers. Necessário: o guard de `stage_role` recusa won/lost fora de
-- admin (ADR-0017 §1), e a fixture precisa dos dois para provar (MA).
SET LOCAL session_replication_role = replica;

-- ===========================================================================
-- Fixtures
-- ===========================================================================
INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('31600000-0000-4000-8000-00000000000a', 'Org CV A', 'org-cv-a', 'America/Sao_Paulo'),
  ('31600000-0000-4000-8000-00000000000b', 'Org CV B', 'org-cv-b', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

-- `fn_metric_measure` chama `assert_org_access`, que exige membro ATIVO da org.
INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
) VALUES
  ('3160115e-0000-4000-8000-00000000000a', 'user-3160a@test.local', '', now(), '{}'::jsonb,
   now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', ''),
  ('3160115e-0000-4000-8000-00000000000b', 'user-3160b@test.local', '', now(), '{}'::jsonb,
   now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- 'member', não 'membro': o enum app_role não tem 'membro'.
INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('31601ea9-0000-4000-8000-00000000000a', '31600000-0000-4000-8000-00000000000a',
   '3160115e-0000-4000-8000-00000000000a', 'Membro CV A', 'member', true),
  ('31601ea9-0000-4000-8000-00000000000b', '31600000-0000-4000-8000-00000000000b',
   '3160115e-0000-4000-8000-00000000000b', 'Membro CV B', 'member', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipelines (id, organization_id, name, slug, type, is_active) VALUES
  ('31609191-0000-4000-8000-00000000000a', '31600000-0000-4000-8000-00000000000a',
   'Funil CV A', 'funil-cv-a', 'custom', true),
  ('31609191-0000-4000-8000-00000000000b', '31600000-0000-4000-8000-00000000000b',
   'Funil CV B', 'funil-cv-b', 'custom', true)
ON CONFLICT (id) DO NOTHING;

-- `metric_stage_role` despacha custom → custom_pipeline_stages.stage_role.
-- 'vendido' e 'perdido' governam; 'proposta' é 'open' — não governa.
--
-- ⚠ `stage_role` é NOT NULL com default 'open'. O comentário de
-- `metric_stage_role` fala em "NULL = nenhum governa", mas esse NULL vem de a
-- LINHA não existir, não da coluna. Passar NULL aqui estoura 23502.
INSERT INTO public.custom_pipeline_stages
  (id, organization_id, pipeline_id, stage_key, name, position, is_active, stage_role) VALUES
  ('31605747-0000-4000-8000-000000000001', '31600000-0000-4000-8000-00000000000a',
   '31609191-0000-4000-8000-00000000000a', 'proposta', 'Proposta', 1, true, 'open'),
  ('31605747-0000-4000-8000-000000000002', '31600000-0000-4000-8000-00000000000a',
   '31609191-0000-4000-8000-00000000000a', 'vendido',  'Vendido',  2, true, 'won'),
  ('31605747-0000-4000-8000-000000000003', '31600000-0000-4000-8000-00000000000a',
   '31609191-0000-4000-8000-00000000000a', 'perdido',  'Perdido',  3, true, 'lost'),
  ('31605747-0000-4000-8000-0000000000b1', '31600000-0000-4000-8000-00000000000b',
   '31609191-0000-4000-8000-00000000000b', 'vendido',  'Vendido',  2, true, 'won')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name, origin, created_at, metrics_period_at) VALUES
  ('3160ead1-0000-4000-8000-000000000001', '31600000-0000-4000-8000-00000000000a', 'Converteu dentro',  'meta_ads',  '2027-08-01T12:00:00Z', '2027-08-01T12:00:00Z'),
  ('3160ead1-0000-4000-8000-000000000002', '31600000-0000-4000-8000-00000000000a', 'Converteu depois',  'meta_ads',  '2027-08-01T12:00:00Z', '2027-08-01T12:00:00Z'),
  ('3160ead1-0000-4000-8000-000000000003', '31600000-0000-4000-8000-00000000000a', 'Perdeu',            'indicacao', '2027-08-01T12:00:00Z', '2027-08-01T12:00:00Z'),
  ('3160ead1-0000-4000-8000-000000000004', '31600000-0000-4000-8000-00000000000a', 'Ainda em aberto',   'indicacao', '2027-08-01T12:00:00Z', '2027-08-01T12:00:00Z'),
  ('3160ead1-0000-4000-8000-000000000005', '31600000-0000-4000-8000-00000000000a', 'Ja estava, reentrou','meta_ads', '2027-07-01T12:00:00Z', '2027-07-01T12:00:00Z'),
  ('3160ead1-0000-4000-8000-0000000000b1', '31600000-0000-4000-8000-00000000000b', 'Lead da org B',     'meta_ads',  '2027-08-01T12:00:00Z', '2027-08-01T12:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key, entered_at, closed_at) VALUES
  ('3160e177-0000-4000-8000-000000000001', '31600000-0000-4000-8000-00000000000a', '31609191-0000-4000-8000-00000000000a', '3160ead1-0000-4000-8000-000000000001', 'vendido',  '2027-08-20T12:00:00Z', NULL),
  ('3160e177-0000-4000-8000-000000000002', '31600000-0000-4000-8000-00000000000a', '31609191-0000-4000-8000-00000000000a', '3160ead1-0000-4000-8000-000000000002', 'vendido',  '2027-09-05T12:00:00Z', NULL),
  ('3160e177-0000-4000-8000-000000000003', '31600000-0000-4000-8000-00000000000a', '31609191-0000-4000-8000-00000000000a', '3160ead1-0000-4000-8000-000000000003', 'perdido',  '2027-08-15T12:00:00Z', NULL),
  ('3160e177-0000-4000-8000-000000000004', '31600000-0000-4000-8000-00000000000a', '31609191-0000-4000-8000-00000000000a', '3160ead1-0000-4000-8000-000000000004', 'proposta', '2027-08-08T12:00:00Z', NULL),
  ('3160e177-0000-4000-8000-000000000005', '31600000-0000-4000-8000-00000000000a', '31609191-0000-4000-8000-00000000000a', '3160ead1-0000-4000-8000-000000000005', 'proposta', '2027-08-10T12:00:00Z', NULL),
  ('3160e177-0000-4000-8000-0000000000b1', '31600000-0000-4000-8000-00000000000b', '31609191-0000-4000-8000-00000000000b', '3160ead1-0000-4000-8000-0000000000b1', 'vendido',  '2027-08-20T12:00:00Z', NULL)
ON CONFLICT (id) DO NOTHING;

-- O CADERNO, e é aqui que a suíte inteira se prova.
--
--   E1  proposta 05/08  → vendido 20/08          coorte SIM · convertido SIM
--   E2  proposta 06/08  → vendido 05/09 (FORA)   coorte SIM · convertido SIM  ← (CB)
--   E3  proposta 07/08  → perdido 15/08          coorte SIM · convertido NÃO · desfecho
--   E4  proposta 08/08  → nada                   coorte SIM · convertido NÃO · em aberto
--   E5  proposta 25/07  → proposta 10/08         coorte NÃO — primeira chegada  ← (RE)
--                                                 foi em julho; reentrar não recria
--   B1  org B, proposta 05/08 → vendido 20/08    coorte NÃO para a org A       ← (XO)
--
--   origem = 4 · convertidos = 2 · em_aberto = 1 · razão = 50,00%
INSERT INTO public.pipeline_stage_events
  (id, organization_id, lead_id, pipeline_id, entry_id, from_stage_key, to_stage_key, occurred_at, source) VALUES
  ('31600e40-0000-4000-8000-000000000011', '31600000-0000-4000-8000-00000000000a', '3160ead1-0000-4000-8000-000000000001', '31609191-0000-4000-8000-00000000000a', '3160e177-0000-4000-8000-000000000001', 'novo',     'proposta', '2027-08-05T12:00:00Z', 'trigger'),
  ('31600e40-0000-4000-8000-000000000012', '31600000-0000-4000-8000-00000000000a', '3160ead1-0000-4000-8000-000000000001', '31609191-0000-4000-8000-00000000000a', '3160e177-0000-4000-8000-000000000001', 'proposta', 'vendido',  '2027-08-20T12:00:00Z', 'trigger'),
  ('31600e40-0000-4000-8000-000000000021', '31600000-0000-4000-8000-00000000000a', '3160ead1-0000-4000-8000-000000000002', '31609191-0000-4000-8000-00000000000a', '3160e177-0000-4000-8000-000000000002', 'novo',     'proposta', '2027-08-06T12:00:00Z', 'trigger'),
  ('31600e40-0000-4000-8000-000000000022', '31600000-0000-4000-8000-00000000000a', '3160ead1-0000-4000-8000-000000000002', '31609191-0000-4000-8000-00000000000a', '3160e177-0000-4000-8000-000000000002', 'proposta', 'vendido',  '2027-09-05T12:00:00Z', 'trigger'),
  ('31600e40-0000-4000-8000-000000000031', '31600000-0000-4000-8000-00000000000a', '3160ead1-0000-4000-8000-000000000003', '31609191-0000-4000-8000-00000000000a', '3160e177-0000-4000-8000-000000000003', 'novo',     'proposta', '2027-08-07T12:00:00Z', 'trigger'),
  ('31600e40-0000-4000-8000-000000000032', '31600000-0000-4000-8000-00000000000a', '3160ead1-0000-4000-8000-000000000003', '31609191-0000-4000-8000-00000000000a', '3160e177-0000-4000-8000-000000000003', 'proposta', 'perdido',  '2027-08-15T12:00:00Z', 'trigger'),
  ('31600e40-0000-4000-8000-000000000041', '31600000-0000-4000-8000-00000000000a', '3160ead1-0000-4000-8000-000000000004', '31609191-0000-4000-8000-00000000000a', '3160e177-0000-4000-8000-000000000004', 'novo',     'proposta', '2027-08-08T12:00:00Z', 'trigger'),
  ('31600e40-0000-4000-8000-000000000051', '31600000-0000-4000-8000-00000000000a', '3160ead1-0000-4000-8000-000000000005', '31609191-0000-4000-8000-00000000000a', '3160e177-0000-4000-8000-000000000005', 'novo',     'proposta', '2027-07-25T12:00:00Z', 'trigger'),
  ('31600e40-0000-4000-8000-000000000052', '31600000-0000-4000-8000-00000000000a', '3160ead1-0000-4000-8000-000000000005', '31609191-0000-4000-8000-00000000000a', '3160e177-0000-4000-8000-000000000005', 'proposta', 'novo',     '2027-08-02T12:00:00Z', 'trigger'),
  ('31600e40-0000-4000-8000-000000000053', '31600000-0000-4000-8000-00000000000a', '3160ead1-0000-4000-8000-000000000005', '31609191-0000-4000-8000-00000000000a', '3160e177-0000-4000-8000-000000000005', 'novo',     'proposta', '2027-08-10T12:00:00Z', 'trigger'),
  ('31600e40-0000-4000-8000-0000000000b1', '31600000-0000-4000-8000-00000000000b', '3160ead1-0000-4000-8000-0000000000b1', '31609191-0000-4000-8000-00000000000b', '3160e177-0000-4000-8000-0000000000b1', 'novo',     'proposta', '2027-08-05T12:00:00Z', 'trigger'),
  ('31600e40-0000-4000-8000-0000000000b2', '31600000-0000-4000-8000-00000000000b', '3160ead1-0000-4000-8000-0000000000b1', '31609191-0000-4000-8000-00000000000b', '3160e177-0000-4000-8000-0000000000b1', 'proposta', 'vendido',  '2027-08-20T12:00:00Z', 'trigger')
ON CONFLICT (id) DO NOTHING;

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"3160115e-0000-4000-8000-00000000000a","role":"authenticated"}', true);

-- ===========================================================================
-- (CT) A COORTE
-- ===========================================================================
SELECT is(
  (public.fn_metric_measure('31600000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"negocios_coorte_origem"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date,
     '{"from_stage_key":"proposta","to_stage_key":"vendido"}'::jsonb) ->> 'value')::bigint,
  4::bigint,
  'CT1: coorte = 4 — os que CHEGARAM a proposta em agosto. E5 fica fora (chegou em julho), B1 é de outra org');

SELECT is(
  (public.fn_metric_measure('31600000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"negocios_coorte_convertidos"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date,
     '{"from_stage_key":"proposta","to_stage_key":"vendido"}'::jsonb) ->> 'value')::bigint,
  2::bigint,
  'CT2: convertidos = 2 — E1 (dentro da janela) e E2 (em setembro, FORA dela)');

-- ===========================================================================
-- (CB) A coorte é seguida além da janela — é o que separa da fluxo/janela
-- ===========================================================================
-- Prova pelo complemento: recortando a janela em 31/08, a conta de FLUXO/JANELA
-- veria só 1 conversão (E1). A de coorte vê 2, porque segue E2 até setembro.
SELECT is(
  (SELECT count(*) FROM public.pipeline_stage_events e
   WHERE e.organization_id = '31600000-0000-4000-8000-00000000000a'
     AND e.to_stage_key = 'vendido'
     AND e.occurred_at <@ tstzrange('2027-08-01T03:00:00Z', '2027-09-01T03:00:00Z', '[)')),
  1::bigint,
  'CB1: só 1 chegada a vendido DENTRO de agosto — a coorte conta 2, e é essa a diferença');

-- ===========================================================================
-- (MA) MATURAÇÃO — quem perdeu já respondeu, quem sumiu ainda não
-- ===========================================================================
SELECT is(
  (public.fn_metric_measure('31600000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"negocios_coorte_em_aberto"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date,
     '{"from_stage_key":"proposta","to_stage_key":"vendido"}'::jsonb) ->> 'value')::bigint,
  1::bigint,
  'MA1: em aberto = 1 (só E4). E3 foi para perdido — teve desfecho, NÃO é maturação');

-- ===========================================================================
-- (RZ) A RAZÃO
-- ===========================================================================
SELECT is(
  (public.fn_metric_measure('31600000-0000-4000-8000-00000000000a',
     '{"kind":"ratio","num":"negocios_coorte_convertidos","den":"negocios_coorte_origem"}'::jsonb,
     'total', 'range', NULL, '2027-08-01'::date, '2027-08-31'::date,
     '{"from_stage_key":"proposta","to_stage_key":"vendido"}'::jsonb) ->> 'value')::numeric,
  50.00::numeric, 'RZ1: 2 de 4 = 50,00%');

SELECT ok(
  (public.fn_metric_measure('31600000-0000-4000-8000-00000000000a',
     '{"kind":"ratio","num":"negocios_coorte_convertidos","den":"negocios_coorte_origem"}'::jsonb,
     'total', 'range', NULL, '2027-08-01'::date, '2027-08-31'::date,
     '{"from_stage_key":"proposta","to_stage_key":"vendido"}'::jsonb) -> 'series') = 'null'::jsonb,
  'RZ2: razão devolve series null SEMPRE — é escalar');

-- O teto por construção: numerador ⊆ denominador, então nunca passa de 100.
SELECT ok(
  (public.fn_metric_measure('31600000-0000-4000-8000-00000000000a',
     '{"kind":"ratio","num":"negocios_coorte_convertidos","den":"negocios_coorte_origem"}'::jsonb,
     'total', 'range', NULL, '2027-08-01'::date, '2027-08-31'::date,
     '{"from_stage_key":"proposta","to_stage_key":"vendido"}'::jsonb) ->> 'value')::numeric
  BETWEEN 0 AND 100,
  'RZ3: a razão vive em [0,100] por construção — é o que a fluxo/janela não garante');

-- ===========================================================================
-- (D0) Coorte vazia é AUSÊNCIA, nunca 0%
-- ===========================================================================
SELECT ok(
  (public.fn_metric_measure('31600000-0000-4000-8000-00000000000a',
     '{"kind":"ratio","num":"negocios_coorte_convertidos","den":"negocios_coorte_origem"}'::jsonb,
     'total', 'range', NULL, '2027-06-01'::date, '2027-06-30'::date,
     '{"from_stage_key":"proposta","to_stage_key":"vendido"}'::jsonb) -> 'value') = 'null'::jsonb,
  'D01: junho não teve coorte — value null, NUNCA 0%');

SELECT is(
  public.fn_metric_measure('31600000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"negocios_coorte_origem"}'::jsonb, 'total', 'range', NULL,
     '2027-06-01'::date, '2027-06-30'::date,
     '{"from_stage_key":"proposta","to_stage_key":"vendido"}'::jsonb) ->> 'empty_reason',
  'no_rows', 'D02: e diz por que está vazio');

-- ===========================================================================
-- (ER) As duas etapas são obrigatórias, e falham ALTO
-- ===========================================================================
SELECT throws_ok($$
  SELECT public.fn_metric_measure('31600000-0000-4000-8000-00000000000a',
    '{"kind":"leaf","id":"negocios_coorte_origem"}'::jsonb, 'total', 'range', NULL,
    '2027-08-01'::date, '2027-08-31'::date, '{"to_stage_key":"vendido"}'::jsonb)
$$, '22023', NULL, 'ER1: sem from_stage_key levanta 22023 — não devolve 0');

SELECT throws_ok($$
  SELECT public.fn_metric_measure('31600000-0000-4000-8000-00000000000a',
    '{"kind":"leaf","id":"negocios_coorte_origem"}'::jsonb, 'total', 'range', NULL,
    '2027-08-01'::date, '2027-08-31'::date, '{"from_stage_key":"proposta"}'::jsonb)
$$, '22023', NULL, 'ER2: sem to_stage_key levanta 22023');

SELECT throws_ok($$
  SELECT public.fn_metric_measure('31600000-0000-4000-8000-00000000000a',
    '{"kind":"leaf","id":"negocios_coorte_origem"}'::jsonb, 'total', 'range', NULL,
    '2027-08-01'::date, '2027-08-31'::date,
    '{"from_stage_key":"proposta","to_stage_key":"proposta"}'::jsonb)
$$, '22023', NULL, 'ER3: origem igual ao destino levanta 22023 — conversão para si mesma é 100% vazio');

-- ER4 fecha o buraco do FILTER: `CASE` sem ELSE devolve NULL, e
-- `FILTER (WHERE NULL)` EXCLUI a linha — modo desconhecido devolveria 0 calado
-- em vez de erro. A checagem é no topo da função, e esta asserção a guarda.
SET LOCAL role postgres;
SELECT throws_ok($$
  SELECT public._metric_leaf_coorte_etapa(
    '31600000-0000-4000-8000-00000000000a', 'total',
    tstzrange('2027-08-01T03:00:00Z','2027-09-01T03:00:00Z','[)'), 'America/Sao_Paulo',
    '{"from_stage_key":"proposta","to_stage_key":"vendido"}'::jsonb, 'modo_que_nao_existe')
$$, '22023', NULL, 'ER4: modo de coorte desconhecido levanta 22023 — não devolve 0 calado');

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"3160115e-0000-4000-8000-00000000000a","role":"authenticated"}', true);

-- ===========================================================================
-- (XO) Cross-org
-- ===========================================================================
SELECT throws_ok($$
  SELECT public.fn_metric_measure('31600000-0000-4000-8000-00000000000b',
    '{"kind":"leaf","id":"negocios_coorte_origem"}'::jsonb, 'total', 'range', NULL,
    '2027-08-01'::date, '2027-08-31'::date,
    '{"from_stage_key":"proposta","to_stage_key":"vendido"}'::jsonb)
$$, 'P0001', NULL, 'XO1: membro da org A pedindo a org B leva access_denied');

-- CT1 = 4 já prova que B1 não entrou na conta da org A. As duas asserções
-- abaixo fecham o cerco pelos dois lados, e a ORDEM importa.
--
-- Primeiro como usuário da org A: a RLS de `pipeline_stage_events` esconde a
-- linha da org B. Escrito antes como `count = 1` sem trocar de papel, este
-- teste FALHOU com `have: 0` — e a falha era o teste, não o motor. Fica como
-- asserção porque é a prova mais direta de que o caderno é isolado.
SELECT is(
  (SELECT count(*) FROM public.pipeline_stage_events e
   WHERE e.organization_id = '31600000-0000-4000-8000-00000000000b'
     AND e.to_stage_key = 'proposta'),
  0::bigint, 'XO2: a RLS esconde o caderno da org B de um usuário da org A');

-- Agora sem RLS: a fixture da org B EXISTE de verdade. Sem esta metade, XO2
-- passaria igual num banco onde a org B simplesmente não foi semeada — e o
-- isolamento estaria "provado" por ausência de dado.
SET LOCAL role postgres;
SELECT is(
  (SELECT count(*) FROM public.pipeline_stage_events e
   WHERE e.organization_id = '31600000-0000-4000-8000-00000000000b'
     AND e.to_stage_key = 'proposta'),
  1::bigint, 'XO3: e a org B tem MESMO a sua coorte de 1 — o isolamento não é falta de dado');

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"3160115e-0000-4000-8000-00000000000a","role":"authenticated"}', true);

-- ===========================================================================
-- (GR) A função da coorte é INTERNA
-- ===========================================================================
SET LOCAL role postgres;

SELECT ok(
  NOT has_function_privilege('anon',
    'public._metric_leaf_coorte_etapa(uuid, text, tstzrange, text, jsonb, text)'::regprocedure, 'EXECUTE'),
  'GR1: anon NÃO executa a coorte');

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public._metric_leaf_coorte_etapa(uuid, text, tstzrange, text, jsonb, text)'::regprocedure, 'EXECUTE'),
  'GR2: authenticated NÃO executa a coorte — senão leria qualquer org por parâmetro');

SELECT ok(
  has_function_privilege('service_role',
    'public._metric_leaf_coorte_etapa(uuid, text, tstzrange, text, jsonb, text)'::regprocedure, 'EXECUTE'),
  'GR3: service_role executa — o motor precisa rodar');

-- ===========================================================================
-- (AL) A allowlist da árvore
-- ===========================================================================
SELECT lives_ok($$
  SELECT public.fn_metric_tree_validate(
    '{"type":"measure","id":"negocios_coorte_origem",
      "filters":{"from_stage_key":"proposta","to_stage_key":"vendido"}}'::jsonb)
$$, 'AL1: a árvore aceita as duas chaves de etapa');

SELECT throws_ok($$
  SELECT public.fn_metric_tree_validate(
    '{"type":"measure","id":"negocios_coorte_origem","filters":{"organization_id":"x"}}'::jsonb)
$$, '22023', NULL, 'AL2: organization_id continua RECUSADO — ele vem do servidor, jamais do payload');

SELECT throws_ok($$
  SELECT public.fn_metric_tree_validate(
    '{"type":"measure","id":"negocios_coorte_origem","filters":{"stage_key":"proposta"}}'::jsonb)
$$, '22023', NULL, 'AL3: chave parecida mas fora da allowlist é recusada — a allowlist não virou frouxa');

-- ===========================================================================
-- (PR) PRESERVAÇÃO — o que a reescrita do validador NÃO pode perder
-- ===========================================================================
-- Esta migration reescreve `_metric_tree_unit` inteira só para mudar uma linha
-- da allowlist. Durante o desenvolvimento a reescrita foi feita de memória e
-- apagou QUATRO validações sem que nenhum teste notasse. Estas asserções
-- existem para que a próxima reescrita não repita — cada uma guarda uma das
-- quatro. Falhou aqui? Alguém reconstruiu o corpo em vez de diferenciá-lo.
SELECT throws_ok($$
  SELECT public.fn_metric_tree_validate(
    '{"type":"op","op":"*","left":{"type":"measure","id":"negocios_coorte_origem"},
      "right":{"type":"literal","value":1e13}}'::jsonb)
$$, '22023', NULL, 'PR1: teto do literal (|x| ≤ 1e12) continua vivo');

SELECT throws_ok($$
  SELECT public.fn_metric_tree_validate(
    '{"type":"literal","value":"5"}'::jsonb)
$$, '22023', NULL, 'PR2: literal precisa ser NÚMERO — a string "5" é recusada');

SELECT throws_ok($$
  SELECT public.fn_metric_tree_validate(
    '{"type":"op","op":"/","left":{"type":"measure","id":"negocios_coorte_origem"}}'::jsonb)
$$, '22023', NULL, 'PR3: operação sem os dois operandos é recusada');

-- `tempo_medio_etapa` não aceita `total`, então não serve de operando. É a
-- validação que impede a árvore de compor medida que só existe em série.
SELECT throws_ok($$
  SELECT public.fn_metric_tree_validate(
    '{"type":"op","op":"/","left":{"type":"measure","id":"tempo_medio_etapa"},
      "right":{"type":"measure","id":"negocios_coorte_origem"}}'::jsonb)
$$, '22023', NULL, 'PR4: operando precisa aceitar recorte total');

SELECT throws_ok($$
  SELECT public.fn_metric_tree_validate(
    '{"type":"op","op":"/",
      "left":{"type":"op","op":"/",
        "left":{"type":"op","op":"/",
          "left":{"type":"measure","id":"negocios_coorte_origem"},
          "right":{"type":"literal","value":2}},
        "right":{"type":"literal","value":2}},
      "right":{"type":"literal","value":2}}'::jsonb)
$$, '22023', NULL, 'PR5: profundidade 4 continua recusada — o teto da Emenda 1 sobreviveu');

-- ===========================================================================
-- (CO) Coerência do preset: count ÷ count com formato percentual
-- ===========================================================================
SELECT is(
  (SELECT format_id FROM public.metric_catalog_ratios WHERE id = 'conversao_entre_etapas'),
  'percent_1',
  'CO1: o preset declara percent_1 — e o motor deriva percent de count÷count, então o par é coerente');

SELECT is(
  (SELECT num_measure_id || '/' || den_measure_id FROM public.metric_catalog_ratios
    WHERE id = 'conversao_entre_etapas'),
  'negocios_coorte_convertidos/negocios_coorte_origem',
  'CO2: numerador e denominador na ordem certa — invertidos dariam o recíproco em silêncio');

SELECT * FROM finish();
ROLLBACK;
