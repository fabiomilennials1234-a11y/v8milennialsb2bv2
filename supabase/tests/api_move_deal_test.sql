-- supabase/tests/api_move_deal_test.sql
--
-- Ticket #1770 — `api_move_deal`.
--
-- A asserção que carrega esta suíte: depois de mover, o Negócio ocupa UMA
-- posição, não duas. Mover é MOVER (ADR-0023 decisão 4) — antes deste modelo,
-- chegar na etapa de sucesso deixava um gêmeo para trás, e era ele que fazia o
-- mesmo Lead aparecer em Qualificação e em Orçamentos ao mesmo tempo.
--
-- Contar a posição DEPOIS é o que distingue mover de copiar. Só verificar que o
-- destino está certo passaria verde nos dois casos.
--
-- Run: bash supabase/tests/run.sh
-- Roda inteiro em transação revertida.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

SELECT is(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'api_move_deal'
      AND (has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0::bigint,
  '(ACL) nem anon nem authenticated executam api_move_deal');

-- ===========================================================================
-- Fixtures
-- ===========================================================================
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('deadbeef-0000-4000-8000-00000000ca01', 'Org Move A', 'org-move-a', 'America/Sao_Paulo'),
  ('deadbeef-0000-4000-8000-00000000ca02', 'Org Move B', 'org-move-b', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name) VALUES
  ('deadbeef-0000-4000-8000-00000000ca0a', 'deadbeef-0000-4000-8000-00000000ca01', 'Lead MA')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipelines (id, organization_id, name, slug, type) VALUES
  ('deadbeef-0000-4000-8000-00000000ca0c', 'deadbeef-0000-4000-8000-00000000ca01', 'Qualificação', 'whatsapp',  'system'),
  ('deadbeef-0000-4000-8000-00000000ca0d', 'deadbeef-0000-4000-8000-00000000ca01', 'Propostas',    'propostas', 'system'),
  ('deadbeef-0000-4000-8000-00000000ca0e', 'deadbeef-0000-4000-8000-00000000ca01', 'Meu Funil',    'meu-funil', 'custom')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.deals (id, organization_id, source_lead_id, title, source, last_activity_at) VALUES
  ('deadbeef-0000-4000-8000-00000000cd01', 'deadbeef-0000-4000-8000-00000000ca01', 'deadbeef-0000-4000-8000-00000000ca0a', 'Para mover', 'api', '2020-01-01T00:00:00Z'),
  ('deadbeef-0000-4000-8000-00000000cd02', 'deadbeef-0000-4000-8000-00000000ca01', 'deadbeef-0000-4000-8000-00000000ca0a', 'Órfão',      'api', '2020-01-01T00:00:00Z');

INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key, deal_id) VALUES
  ('deadbeef-0000-4000-8000-00000000ce01', 'deadbeef-0000-4000-8000-00000000ca01', 'deadbeef-0000-4000-8000-00000000ca0c', 'deadbeef-0000-4000-8000-00000000ca0a', 'novo', 'deadbeef-0000-4000-8000-00000000cd01');

SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- (MOVER) o caminho feliz — e a contagem que distingue mover de copiar
-- ===========================================================================
SELECT is(
  (SELECT count(*) FROM public.pipeline_entries
    WHERE deal_id = 'deadbeef-0000-4000-8000-00000000cd01'),
  1::bigint,
  '(ANTES) o Negócio ocupa UMA posição');

SELECT is(
  (SELECT (public.api_move_deal(
     'deadbeef-0000-4000-8000-00000000ca01',
     'deadbeef-0000-4000-8000-00000000cd01',
     'propostas', 'enviada'))->>'pipeline_slug'),
  'propostas',
  '(MOVER) a resposta traz a posição NOVA');

SELECT is(
  (SELECT (public.api_get_deal(
     'deadbeef-0000-4000-8000-00000000ca01',
     'deadbeef-0000-4000-8000-00000000cd01'))->>'stage_key'),
  'enviada',
  '(MOVER) e a etapa nova persiste');

-- ⚠️ A ASSERÇÃO QUE CARREGA A SUÍTE. Copiar em vez de mover daria 2 aqui, e
-- todas as outras asserções continuariam verdes.
SELECT is(
  (SELECT count(*) FROM public.pipeline_entries
    WHERE deal_id = 'deadbeef-0000-4000-8000-00000000cd01'),
  1::bigint,
  '(MOVER) DEPOIS o Negócio segue ocupando UMA posição — moveu, não copiou');

SELECT is(
  (SELECT count(*) FROM public.pipeline_entries
    WHERE deal_id = 'deadbeef-0000-4000-8000-00000000cd01'
      AND pipeline_id = 'deadbeef-0000-4000-8000-00000000ca0c'),
  0::bigint,
  '(MOVER) e não sobrou gêmeo no funil de origem');

SELECT ok(
  (SELECT last_activity_at FROM public.deals WHERE id = 'deadbeef-0000-4000-8000-00000000cd01')
    > '2020-01-01T00:00:00Z',
  '(MOVER) mover carimba last_activity_at — entra no delta de quem sincroniza');

-- ===========================================================================
-- (RECUSAS)
-- ===========================================================================
SELECT throws_ok(
  $$ SELECT public.api_move_deal(
       'deadbeef-0000-4000-8000-00000000ca01',
       'deadbeef-0000-4000-8000-00000000cd01',
       'custom:deadbeef-0000-4000-8000-00000000ca0e', 'x') $$,
  '22023', NULL,
  '(RECUSA) funil customizado como destino — o card mudaria de identidade e perderia o histórico');

SELECT throws_ok(
  $$ SELECT public.api_move_deal(
       'deadbeef-0000-4000-8000-00000000ca01',
       'deadbeef-0000-4000-8000-00000000cd01',
       'nao-existe', 'x') $$,
  '22023', NULL,
  '(RECUSA) funil que não existe nesta organização');

-- Negócio sem posição: mover não é a operação certa, e a mensagem diz isso em
-- vez de estourar num NULL lá dentro. São 11.710 assim em produção.
SELECT throws_ok(
  $$ SELECT public.api_move_deal(
       'deadbeef-0000-4000-8000-00000000ca01',
       'deadbeef-0000-4000-8000-00000000cd02',
       'propostas', 'enviada') $$,
  'P0002', NULL,
  '(RECUSA) Negócio órfão — não há o que mover, e a mensagem diz isso');

SELECT throws_ok(
  $$ SELECT public.api_move_deal(
       'deadbeef-0000-4000-8000-00000000ca02',
       'deadbeef-0000-4000-8000-00000000cd01',
       'propostas', 'enviada') $$,
  'P0002', NULL,
  '(TENANT) mover Negócio de outra organização é recusado como inexistente');

-- E o Negócio segue onde estava: a recusa não foi só de mensagem.
SELECT is(
  (SELECT (public.api_get_deal(
     'deadbeef-0000-4000-8000-00000000ca01',
     'deadbeef-0000-4000-8000-00000000cd01'))->>'pipeline_slug'),
  'propostas',
  '(TENANT) e a posição não mudou depois das recusas');

ROLLBACK;
