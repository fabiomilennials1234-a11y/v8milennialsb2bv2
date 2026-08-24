-- supabase/tests/deal_last_activity_test.sql
--
-- Ticket #1766 — última atividade do Negócio.
--
-- O furo que esta coluna fecha: mover um Negócio escreve SÓ em
-- `pipeline_entries` e não toca `deals`. Um conector sincronizando pelo campo de
-- atualização comum ficaria cego justamente para a mudança de Stage — o evento
-- que interessa. Verificado no corpo de `mover_negocio`: ele faz dois UPDATE em
-- `pipeline_entries` e nenhum em `deals`.
--
-- A coluna nova responde "aconteceu algo com este Negócio". `updated_at` segue
-- respondendo "os dados deste Negócio mudaram". As duas perguntas são diferentes
-- e as duas vão ser feitas quando existir sincronização de mão dupla — por isso
-- não carimbamos `updated_at` e pronto.
--
-- ⚠️ As fixtures rodam sob `session_replication_role = replica`, que DESLIGA
-- gatilho. As asserções de gatilho voltam para `origin` antes de exercitar —
-- sem isso a suíte passaria por ausência, provando nada.
--
-- Run: bash supabase/tests/run.sh
-- Roda inteiro em transação revertida.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- ===========================================================================
-- (STRUCT)
-- ===========================================================================
SELECT has_column('public', 'deals', 'last_activity_at',
  '(STRUCT) deals.last_activity_at existe');

SELECT ok(
  EXISTS (SELECT 1 FROM pg_indexes
           WHERE schemaname = 'public' AND tablename = 'deals'
             AND indexdef ILIKE '%last_activity_at%'),
  '(STRUCT) há índice sobre last_activity_at — é a chave do cursor do polling');

-- ===========================================================================
-- Fixtures (gatilho desligado de propósito: aqui só montamos o cenário)
-- ===========================================================================
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone)
VALUES ('deadbeef-0000-4000-8000-0000000000b1', 'Org atividade', 'org-atividade', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name)
VALUES ('deadbeef-0000-4000-8000-0000000000b2', 'deadbeef-0000-4000-8000-0000000000b1', 'Lead Atividade')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipelines (id, organization_id, name, slug, type)
VALUES ('deadbeef-0000-4000-8000-0000000000b3', 'deadbeef-0000-4000-8000-0000000000b1', 'Qualificação', 'whatsapp', 'system')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.deals (id, organization_id, source_lead_id, title, last_activity_at, updated_at, source)
VALUES ('deadbeef-0000-4000-8000-0000000000b4', 'deadbeef-0000-4000-8000-0000000000b1',
        'deadbeef-0000-4000-8000-0000000000b2', 'Negócio Atividade',
        '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z', 'human');

INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key, deal_id)
VALUES ('deadbeef-0000-4000-8000-0000000000b5', 'deadbeef-0000-4000-8000-0000000000b1',
        'deadbeef-0000-4000-8000-0000000000b3', 'deadbeef-0000-4000-8000-0000000000b2',
        'novo', 'deadbeef-0000-4000-8000-0000000000b4');

-- ===========================================================================
-- A PARTIR DAQUI O GATILHO VOLTA. É o que a suíte existe para provar.
-- ===========================================================================
SET LOCAL session_replication_role = origin;

-- CONTROLE POSITIVO: sem ele, uma suíte em que NADA dispara passaria como verde.
-- Mudar a própria linha tem de carimbar as duas colunas.
UPDATE public.deals SET title = 'Renegociado'
 WHERE id = 'deadbeef-0000-4000-8000-0000000000b4';

SELECT ok(
  (SELECT last_activity_at FROM public.deals WHERE id = 'deadbeef-0000-4000-8000-0000000000b4')
    > '2020-01-01T00:00:00Z',
  '(CONTROLE) editar o Negócio carimba last_activity_at');

SELECT ok(
  (SELECT updated_at FROM public.deals WHERE id = 'deadbeef-0000-4000-8000-0000000000b4')
    > '2020-01-01T00:00:00Z',
  '(CONTROLE) editar o Negócio carimba updated_at');

-- Linha de base para medir o MOVE isoladamente.
--
-- `updated_at` NÃO pode ser recuado: `update_deals_updated_at` carimba now() em
-- todo UPDATE, sem condição. Então a pergunta certa não é "vale 2020?" e sim
-- "mudou entre antes e depois do move?" — que é o que a integração enxergaria.
UPDATE public.deals SET last_activity_at = '2020-01-01T00:00:00Z'
 WHERE id = 'deadbeef-0000-4000-8000-0000000000b4';

CREATE TEMP TABLE base_atividade AS
SELECT updated_at AS ua FROM public.deals WHERE id = 'deadbeef-0000-4000-8000-0000000000b4';

-- ── O CASO QUE MOTIVA A COLUNA ─────────────────────────────────────────────
-- Mover o Negócio escreve só na posição. A última atividade tem de andar mesmo
-- assim; o campo de atualização, não.
UPDATE public.pipeline_entries SET stage_key = 'abordado'
 WHERE id = 'deadbeef-0000-4000-8000-0000000000b5';

SELECT ok(
  (SELECT last_activity_at FROM public.deals WHERE id = 'deadbeef-0000-4000-8000-0000000000b4')
    > '2020-01-01T00:00:00Z',
  '(MOVE) mudar a Stage carimba last_activity_at do Negócio');

SELECT is(
  (SELECT updated_at FROM public.deals WHERE id = 'deadbeef-0000-4000-8000-0000000000b4'),
  (SELECT ua FROM base_atividade),
  '(MOVE) mudar a Stage NÃO mexe em updated_at — a distinção entre as duas perguntas se mantém');

-- ── Posição sem Negócio não pode derrubar nada ─────────────────────────────
SELECT lives_ok(
  $$ UPDATE public.pipeline_entries SET stage_key = 'respondeu'
      WHERE id = 'deadbeef-0000-4000-8000-0000000000b5' $$,
  '(ROBUSTEZ) mover posição funciona; e posição sem deal_id não derruba o gatilho');

SET LOCAL session_replication_role = replica;
INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key, deal_id)
VALUES ('deadbeef-0000-4000-8000-0000000000b6', 'deadbeef-0000-4000-8000-0000000000b1',
        'deadbeef-0000-4000-8000-0000000000b3', 'deadbeef-0000-4000-8000-0000000000b2',
        'novo', NULL);
SET LOCAL session_replication_role = origin;

SELECT lives_ok(
  $$ UPDATE public.pipeline_entries SET stage_key = 'abordado'
      WHERE id = 'deadbeef-0000-4000-8000-0000000000b6' $$,
  '(ROBUSTEZ) posição órfã (sem Negócio) move sem erro — 11.655 delas existem em prod');

ROLLBACK;
