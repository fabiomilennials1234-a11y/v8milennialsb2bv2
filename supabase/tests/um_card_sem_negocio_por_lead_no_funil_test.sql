-- supabase/tests/um_card_sem_negocio_por_lead_no_funil_test.sql
--
-- Um card aberto SEM negócio por lead em cada funil (20271119000000).
--
-- O que este arquivo trava:
--   (ÍNDICE)    segundo card aberto sem negócio do mesmo lead no mesmo funil é
--               recusado com 23505 — a corrida webhook × workflow perde aqui;
--   (RECOMPRA)  card COM negócio fica fora: dois negócios abertos do mesmo lead
--               no mesmo funil continuam possíveis (ADR-0023 decisão 2), e card
--               fechado também não conta;
--   (FUNDE)     mover card sem negócio para funil onde o lead já tem um funde
--               no que já está lá: devolve o id dele, ele mantém a etapa, os
--               dependentes vêm junto e o card de origem some;
--   (MOVE)      sem card no destino, mover continua sendo o UPDATE de sempre;
--               card COM negócio nunca é fundido;
--   (BULK)      move em massa conta o card fundido e não acusa "não autorizada";
--   (GUARDA)    a porta de fusão recusa card com negócio, lead diferente, e
--               anon não executa.
--
-- Run: bash supabase/tests/run.sh
-- Roda inteiro em transação revertida.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- ===========================================================================
-- Fixtures
-- ===========================================================================
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('deadbeef-0000-4000-8000-0000000cd001', 'Org Um Card', 'org-um-card', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name) VALUES
  ('deadbeef-0000-4000-8000-0000000c1001', 'deadbeef-0000-4000-8000-0000000cd001', 'Corrida webhook'),
  ('deadbeef-0000-4000-8000-0000000c1002', 'deadbeef-0000-4000-8000-0000000cd001', 'Recompra'),
  ('deadbeef-0000-4000-8000-0000000c1003', 'deadbeef-0000-4000-8000-0000000cd001', 'Move funde'),
  ('deadbeef-0000-4000-8000-0000000c1004', 'deadbeef-0000-4000-8000-0000000cd001', 'Move livre'),
  ('deadbeef-0000-4000-8000-0000000c1005', 'deadbeef-0000-4000-8000-0000000cd001', 'Move com negócio'),
  ('deadbeef-0000-4000-8000-0000000c1006', 'deadbeef-0000-4000-8000-0000000cd001', 'Bulk funde')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipelines (id, organization_id, name, slug, type, is_active) VALUES
  ('deadbeef-0000-4000-8000-0000000cb001', 'deadbeef-0000-4000-8000-0000000cd001', 'Prospecção', 'um-card-x', 'custom', true),
  ('deadbeef-0000-4000-8000-0000000cb002', 'deadbeef-0000-4000-8000-0000000cd001', 'Reativação', 'um-card-y', 'custom', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipeline_stages
  (id, organization_id, pipeline_id, pipeline_type, stage_key, name, position, is_active)
VALUES
  ('deadbeef-0000-4000-8000-0000000cc001', 'deadbeef-0000-4000-8000-0000000cd001',
   'deadbeef-0000-4000-8000-0000000cb001', NULL, 'entrada', 'Entrada', 0, true),
  ('deadbeef-0000-4000-8000-0000000cc002', 'deadbeef-0000-4000-8000-0000000cd001',
   'deadbeef-0000-4000-8000-0000000cb002', NULL, 'novo', 'Novo', 0, true),
  ('deadbeef-0000-4000-8000-0000000cc003', 'deadbeef-0000-4000-8000-0000000cd001',
   'deadbeef-0000-4000-8000-0000000cb002', NULL, 'contato', 'Contato', 1, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.deals (id, organization_id, title, source) VALUES
  ('deadbeef-0000-4000-8000-0000000cde01', 'deadbeef-0000-4000-8000-0000000cd001', 'Primeira compra', 'human'),
  ('deadbeef-0000-4000-8000-0000000cde02', 'deadbeef-0000-4000-8000-0000000cd001', 'Recompra', 'human'),
  ('deadbeef-0000-4000-8000-0000000cde03', 'deadbeef-0000-4000-8000-0000000cd001', 'Negócio que move', 'human')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipeline_entries
  (id, organization_id, pipeline_id, lead_id, deal_id, stage_id, stage_key, closed_at, stage_changed_at)
VALUES
  -- Corrida: o card que o webhook criou primeiro.
  ('deadbeef-0000-4000-8000-0000000ce001', 'deadbeef-0000-4000-8000-0000000cd001',
   'deadbeef-0000-4000-8000-0000000cb001', 'deadbeef-0000-4000-8000-0000000c1001', NULL,
   'deadbeef-0000-4000-8000-0000000cc001', 'entrada', NULL, now()),
  -- Recompra: dois negócios abertos + um card sem negócio fechado.
  ('deadbeef-0000-4000-8000-0000000ce002', 'deadbeef-0000-4000-8000-0000000cd001',
   'deadbeef-0000-4000-8000-0000000cb001', 'deadbeef-0000-4000-8000-0000000c1002',
   'deadbeef-0000-4000-8000-0000000cde01', 'deadbeef-0000-4000-8000-0000000cc001', 'entrada', NULL, now()),
  ('deadbeef-0000-4000-8000-0000000ce003', 'deadbeef-0000-4000-8000-0000000cd001',
   'deadbeef-0000-4000-8000-0000000cb001', 'deadbeef-0000-4000-8000-0000000c1002', NULL,
   'deadbeef-0000-4000-8000-0000000cc001', 'entrada', now() - interval '1 day', now()),
  -- Move funde: um em X, outro (em Contato) em Y.
  ('deadbeef-0000-4000-8000-0000000ce004', 'deadbeef-0000-4000-8000-0000000cd001',
   'deadbeef-0000-4000-8000-0000000cb001', 'deadbeef-0000-4000-8000-0000000c1003', NULL,
   'deadbeef-0000-4000-8000-0000000cc001', 'entrada', NULL, now()),
  ('deadbeef-0000-4000-8000-0000000ce005', 'deadbeef-0000-4000-8000-0000000cd001',
   'deadbeef-0000-4000-8000-0000000cb002', 'deadbeef-0000-4000-8000-0000000c1003', NULL,
   'deadbeef-0000-4000-8000-0000000cc003', 'contato', NULL, now()),
  -- Move livre: só em X.
  ('deadbeef-0000-4000-8000-0000000ce006', 'deadbeef-0000-4000-8000-0000000cd001',
   'deadbeef-0000-4000-8000-0000000cb001', 'deadbeef-0000-4000-8000-0000000c1004', NULL,
   'deadbeef-0000-4000-8000-0000000cc001', 'entrada', NULL, now()),
  -- Move com negócio: negócio em X, card sem negócio em Y.
  ('deadbeef-0000-4000-8000-0000000ce007', 'deadbeef-0000-4000-8000-0000000cd001',
   'deadbeef-0000-4000-8000-0000000cb001', 'deadbeef-0000-4000-8000-0000000c1005',
   'deadbeef-0000-4000-8000-0000000cde03', 'deadbeef-0000-4000-8000-0000000cc001', 'entrada', NULL, now()),
  ('deadbeef-0000-4000-8000-0000000ce008', 'deadbeef-0000-4000-8000-0000000cd001',
   'deadbeef-0000-4000-8000-0000000cb002', 'deadbeef-0000-4000-8000-0000000c1005', NULL,
   'deadbeef-0000-4000-8000-0000000cc002', 'novo', NULL, now()),
  -- Bulk funde: um em X, outro em Y (Contato).
  ('deadbeef-0000-4000-8000-0000000ce009', 'deadbeef-0000-4000-8000-0000000cd001',
   'deadbeef-0000-4000-8000-0000000cb001', 'deadbeef-0000-4000-8000-0000000c1006', NULL,
   'deadbeef-0000-4000-8000-0000000cc001', 'entrada', NULL, now()),
  ('deadbeef-0000-4000-8000-0000000ce010', 'deadbeef-0000-4000-8000-0000000cd001',
   'deadbeef-0000-4000-8000-0000000cb002', 'deadbeef-0000-4000-8000-0000000c1006', NULL,
   'deadbeef-0000-4000-8000-0000000cc003', 'contato', NULL, now());

-- Comentário preso ao card que vai ser fundido.
INSERT INTO public.lead_comments (id, organization_id, lead_id, pipeline_entry_id, body) VALUES
  ('deadbeef-0000-4000-8000-0000000cf001', 'deadbeef-0000-4000-8000-0000000cd001',
   'deadbeef-0000-4000-8000-0000000c1003', 'deadbeef-0000-4000-8000-0000000ce004', 'ligou ontem');

SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- (ÍNDICE)
-- ===========================================================================
SELECT has_index('public', 'pipeline_entries', 'uq_pipeline_entries_um_card_sem_negocio',
  '(ÍNDICE) a invariante existe');

SELECT throws_ok(
  $$ INSERT INTO public.pipeline_entries
       (organization_id, pipeline_id, lead_id, stage_id, stage_key)
     VALUES ('deadbeef-0000-4000-8000-0000000cd001', 'deadbeef-0000-4000-8000-0000000cb001',
             'deadbeef-0000-4000-8000-0000000c1001', 'deadbeef-0000-4000-8000-0000000cc001', 'entrada') $$,
  '23505', NULL,
  '(ÍNDICE) o segundo card sem negócio do lead no funil é recusado — a corrida perde aqui');

SELECT throws_ok(
  $$ SELECT public.fn_entrada_custom_criar(
       'deadbeef-0000-4000-8000-0000000cd001', 'deadbeef-0000-4000-8000-0000000cb001',
       'deadbeef-0000-4000-8000-0000000c1001', 'deadbeef-0000-4000-8000-0000000cc001') $$,
  '23505', NULL,
  '(ÍNDICE) a porta de criação custom também esbarra');

-- ===========================================================================
-- (RECOMPRA)
-- ===========================================================================
SELECT lives_ok(
  $$ INSERT INTO public.pipeline_entries
       (organization_id, pipeline_id, lead_id, deal_id, stage_id, stage_key)
     VALUES ('deadbeef-0000-4000-8000-0000000cd001', 'deadbeef-0000-4000-8000-0000000cb001',
             'deadbeef-0000-4000-8000-0000000c1002', 'deadbeef-0000-4000-8000-0000000cde02',
             'deadbeef-0000-4000-8000-0000000cc001', 'entrada') $$,
  '(RECOMPRA) segundo negócio aberto do mesmo lead no mesmo funil continua possível');

SELECT lives_ok(
  $$ INSERT INTO public.pipeline_entries
       (organization_id, pipeline_id, lead_id, stage_id, stage_key)
     VALUES ('deadbeef-0000-4000-8000-0000000cd001', 'deadbeef-0000-4000-8000-0000000cb001',
             'deadbeef-0000-4000-8000-0000000c1002', 'deadbeef-0000-4000-8000-0000000cc001', 'entrada') $$,
  '(RECOMPRA) card sem negócio ao lado de negócios abertos e de um card sem negócio FECHADO');

-- ===========================================================================
-- (FUNDE)
-- ===========================================================================
SELECT is(
  public.mover_negocio('deadbeef-0000-4000-8000-0000000ce004',
                       'deadbeef-0000-4000-8000-0000000cb002', 'novo'),
  'deadbeef-0000-4000-8000-0000000ce005'::uuid,
  '(FUNDE) devolve o card que o lead JÁ tinha no destino');

SELECT is(
  (SELECT count(*) FROM public.pipeline_entries
    WHERE lead_id = 'deadbeef-0000-4000-8000-0000000c1003'),
  1::bigint,
  '(FUNDE) sobra UM card do lead — o de origem foi apagado, nada duplicou');

SELECT is(
  (SELECT stage_key FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-0000000ce005'),
  'contato',
  '(FUNDE) o card que ficou mantém a etapa — mover reabriria as automações de entrada');

SELECT is(
  (SELECT pipeline_entry_id FROM public.lead_comments WHERE id = 'deadbeef-0000-4000-8000-0000000cf001'),
  'deadbeef-0000-4000-8000-0000000ce005'::uuid,
  '(FUNDE) o comentário do card de origem veio junto');

-- ===========================================================================
-- (MOVE)
-- ===========================================================================
SELECT is(
  public.mover_negocio('deadbeef-0000-4000-8000-0000000ce006',
                       'deadbeef-0000-4000-8000-0000000cb002', 'novo'),
  'deadbeef-0000-4000-8000-0000000ce006'::uuid,
  '(MOVE) sem card no destino, o próprio card é movido');

SELECT is(
  (SELECT pipeline_id FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-0000000ce006'),
  'deadbeef-0000-4000-8000-0000000cb002'::uuid,
  '(MOVE) e está no funil de destino');

SELECT is(
  public.mover_negocio('deadbeef-0000-4000-8000-0000000ce007',
                       'deadbeef-0000-4000-8000-0000000cb002', 'novo'),
  'deadbeef-0000-4000-8000-0000000ce007'::uuid,
  '(MOVE) card COM negócio nunca é fundido — move ao lado do card sem negócio');

SELECT is(
  (SELECT count(*) FROM public.pipeline_entries
    WHERE lead_id = 'deadbeef-0000-4000-8000-0000000c1005'
      AND pipeline_id = 'deadbeef-0000-4000-8000-0000000cb002'),
  2::bigint,
  '(MOVE) os dois seguem existindo: negócio e card sem negócio');

-- ===========================================================================
-- (BULK)
-- ===========================================================================
SELECT is(
  public.bulk_move_pipeline_entries(
    ARRAY['deadbeef-0000-4000-8000-0000000ce009']::uuid[],
    'deadbeef-0000-4000-8000-0000000cb001',
    'deadbeef-0000-4000-8000-0000000cb002',
    'deadbeef-0000-4000-8000-0000000cc002'),
  1,
  '(BULK) o card fundido conta como movido');

SELECT is(
  (SELECT count(*) FROM public.pipeline_entries
    WHERE lead_id = 'deadbeef-0000-4000-8000-0000000c1006'),
  1::bigint,
  '(BULK) mover em massa não planta duplicado');

-- ===========================================================================
-- (GUARDA)
-- ===========================================================================
SELECT throws_ok(
  $$ SELECT public._repontar_dependentes_do_card(
       'deadbeef-0000-4000-8000-0000000ce007', 'deadbeef-0000-4000-8000-0000000ce008') $$,
  '23514', NULL,
  '(GUARDA) card com negócio não entra em fusão');

SELECT throws_ok(
  $$ SELECT public._repontar_dependentes_do_card(
       'deadbeef-0000-4000-8000-0000000ce001', 'deadbeef-0000-4000-8000-0000000ce008') $$,
  '23514', NULL,
  '(GUARDA) cards de leads diferentes não se fundem');

SELECT ok(
  NOT has_function_privilege('anon', 'public._repontar_dependentes_do_card(uuid, uuid)', 'EXECUTE'),
  '(GUARDA) anon não executa a porta de fusão');

SELECT * FROM finish();
ROLLBACK;
