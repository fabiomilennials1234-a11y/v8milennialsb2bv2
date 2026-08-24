-- supabase/tests/deal_procedencia_test.sql
--
-- Ticket #1763 — Procedência do Negócio (passo *expand* do expand–contract).
--
-- A Procedência é a porta por onde o Negócio nasceu. É TRILHA, não estado:
-- escrita uma vez no nascimento e nunca reescrita. `created_by` não serve para
-- isso — ele nomeia uma PESSOA e é nulo para toda porta que não é uma (está
-- vazio em 100% das 34.966 linhas do backfill de 2026-08-23).
--
-- Neste passo a coluna nasce ANULÁVEL, ao lado do que existe, para que nenhum
-- caminho de criação quebre. A obrigatoriedade é o ticket #1765 (*contract*),
-- e só entra depois que todos os caminhos gravarem.
--
-- Run: bash supabase/tests/run.sh
-- Roda inteiro em transação revertida.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- ===========================================================================
-- (STRUCT) a coluna existe, e existe ANULÁVEL
-- ===========================================================================
SELECT has_column('public', 'deals', 'source', '(STRUCT) deals.source existe');

SELECT col_is_null(
  'public', 'deals', 'source',
  '(STRUCT) source ainda é anulável — obrigatoriedade é o passo contract (#1765)');

-- ===========================================================================
-- (STRUCT) o vocabulário é fechado pelo banco, não pela boa vontade do chamador
-- ===========================================================================
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone)
VALUES ('deadbeef-0000-4000-8000-0000000000a1', 'Org procedência', 'org-proc', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name)
VALUES ('deadbeef-0000-4000-8000-0000000000a2', 'deadbeef-0000-4000-8000-0000000000a1', 'Lead Procedência')
ON CONFLICT (id) DO NOTHING;

-- CONTROLE POSITIVO: cada valor do vocabulário entra. Sem isto, uma suíte em que
-- TUDO é recusado (coluna com CHECK errado, por exemplo) passaria como verde.
SELECT lives_ok(
  $$ INSERT INTO public.deals (id, organization_id, source_lead_id, title, source)
     VALUES (gen_random_uuid(), 'deadbeef-0000-4000-8000-0000000000a1',
             'deadbeef-0000-4000-8000-0000000000a2', 'N', 'human') $$,
  '(VOCAB) human aceito');

SELECT lives_ok(
  $$ INSERT INTO public.deals (id, organization_id, source_lead_id, title, source)
     VALUES (gen_random_uuid(), 'deadbeef-0000-4000-8000-0000000000a1',
             'deadbeef-0000-4000-8000-0000000000a2', 'N', 'workflow') $$,
  '(VOCAB) workflow aceito');

SELECT lives_ok(
  $$ INSERT INTO public.deals (id, organization_id, source_lead_id, title, source)
     VALUES (gen_random_uuid(), 'deadbeef-0000-4000-8000-0000000000a1',
             'deadbeef-0000-4000-8000-0000000000a2', 'N', 'api') $$,
  '(VOCAB) api aceito');

SELECT lives_ok(
  $$ INSERT INTO public.deals (id, organization_id, source_lead_id, title, source)
     VALUES (gen_random_uuid(), 'deadbeef-0000-4000-8000-0000000000a1',
             'deadbeef-0000-4000-8000-0000000000a2', 'N', 'import') $$,
  '(VOCAB) import aceito');

SELECT lives_ok(
  $$ INSERT INTO public.deals (id, organization_id, source_lead_id, title, source)
     VALUES (gen_random_uuid(), 'deadbeef-0000-4000-8000-0000000000a1',
             'deadbeef-0000-4000-8000-0000000000a2', 'N', 'backfill') $$,
  '(VOCAB) backfill aceito');

-- E o que está fora do vocabulário é recusado pelo BANCO.
SELECT throws_ok(
  $$ INSERT INTO public.deals (id, organization_id, source_lead_id, title, source)
     VALUES (gen_random_uuid(), 'deadbeef-0000-4000-8000-0000000000a1',
             'deadbeef-0000-4000-8000-0000000000a2', 'N', 'ingest') $$,
  '23514', NULL,
  '(VOCAB) ingest recusado — saiu do vocabulário de propósito, por não ter caso');

SELECT throws_ok(
  $$ INSERT INTO public.deals (id, organization_id, source_lead_id, title, source)
     VALUES (gen_random_uuid(), 'deadbeef-0000-4000-8000-0000000000a1',
             'deadbeef-0000-4000-8000-0000000000a2', 'N', 'HUMAN') $$,
  '23514', NULL,
  '(VOCAB) o vocabulário é sensível a caixa — HUMAN não é human');

-- Anulável ainda passa: é o que garante que nenhum caminho existente quebrou.
SELECT lives_ok(
  $$ INSERT INTO public.deals (id, organization_id, source_lead_id, title)
     VALUES (gen_random_uuid(), 'deadbeef-0000-4000-8000-0000000000a1',
             'deadbeef-0000-4000-8000-0000000000a2', 'N sem procedência') $$,
  '(EXPAND) criar sem Procedência ainda funciona — nada quebrou neste passo');

-- ===========================================================================
-- (BACKFILL) as linhas da virada respondem "backfill"
-- ===========================================================================
-- O backfill de 2026-08-23 deixou rastro próprio em metadata. É por ele que as
-- 34.966 linhas são identificadas — e a asserção é de COBERTURA TOTAL, não de
-- amostra: zero linha com o rastro pode ficar sem Procedência.
SELECT is(
  (SELECT count(*) FROM public.deals
    WHERE metadata ? 'backfilled_from_entry' AND source IS DISTINCT FROM 'backfill'),
  0::bigint,
  '(BACKFILL) toda linha com rastro da virada está marcada como backfill');

ROLLBACK;
