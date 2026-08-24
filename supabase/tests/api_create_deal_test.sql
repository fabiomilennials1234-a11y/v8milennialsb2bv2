-- supabase/tests/api_create_deal_test.sql
--
-- Ticket #1769 — `api_create_deal`, o guardião do registro por trás de
-- POST /deals. E o #1764, que fez `abrir_negocio` gravar a Procedência.
--
-- ⚠️ A ASSERÇÃO MAIS IMPORTANTE DESTE ARQUIVO É A DE INQUILINO.
-- `api_create_deal` é SECURITY DEFINER e recebe a organização POR PARÂMETRO —
-- exatamente a forma que já produziu vazamento cross-tenant neste repositório.
-- O que a torna segura é o recorte explícito no corpo (o Lead tem de ser da org
-- informada) somado a `authenticated` e `anon` sem EXECUTE. As duas coisas são
-- afirmadas aqui, e a segunda é a que impede que um usuário logado chame a
-- função passando a org do vizinho.
--
-- Run: bash supabase/tests/run.sh
-- Roda inteiro em transação revertida.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- ===========================================================================
-- (ACL) DEFINER com org por parâmetro só pode ser chamada por service_role
-- ===========================================================================
SELECT ok(
  NOT has_function_privilege('anon',
    'public.api_create_deal(uuid,uuid,text,text,uuid,numeric,text,text,text,text)', 'EXECUTE'),
  '(ACL) anon NÃO executa api_create_deal');

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public.api_create_deal(uuid,uuid,text,text,uuid,numeric,text,text,text,text)', 'EXECUTE'),
  '(ACL) authenticated NÃO executa — é DEFINER e recebe a org por parâmetro');

SELECT is(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'abrir_negocio'),
  1::bigint,
  '(ACL) abrir_negocio tem UMA assinatura — overload faria o PostgREST resolver a antiga, sem Procedência');

-- ===========================================================================
-- Fixtures: duas organizações, cada uma com funil de sistema
-- ===========================================================================
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('deadbeef-0000-4000-8000-0000000000f1', 'Org Deal A', 'org-deal-a', 'America/Sao_Paulo'),
  ('deadbeef-0000-4000-8000-0000000000f2', 'Org Deal B', 'org-deal-b', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name) VALUES
  ('deadbeef-0000-4000-8000-0000000000fa', 'deadbeef-0000-4000-8000-0000000000f1', 'Lead A'),
  ('deadbeef-0000-4000-8000-0000000000fb', 'deadbeef-0000-4000-8000-0000000000f2', 'Lead B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipelines (id, organization_id, name, slug, type) VALUES
  ('deadbeef-0000-4000-8000-0000000000fc', 'deadbeef-0000-4000-8000-0000000000f1', 'Qualificação', 'whatsapp', 'system')
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- (TENANT) o recorte que a ausência de RLS obriga
-- ===========================================================================
SELECT throws_ok(
  $$ SELECT public.api_create_deal(
       'deadbeef-0000-4000-8000-0000000000f1',   -- org A
       'deadbeef-0000-4000-8000-0000000000fb',   -- lead da org B
       'whatsapp', 'novo') $$,
  'P0002', NULL,
  '(TENANT) Lead de OUTRA organização é recusado — o recorte não depende de RLS aqui');

-- ===========================================================================
-- (CRIAR) o caminho feliz, com a Procedência
-- ===========================================================================
CREATE TEMP TABLE d1 AS
SELECT public.api_create_deal(
  'deadbeef-0000-4000-8000-0000000000f1',
  'deadbeef-0000-4000-8000-0000000000fa',
  'whatsapp', 'novo', NULL, 990, 'Primeiro Negócio', NULL, 'api', 'dk-1') AS j;

SELECT is((SELECT j->>'status' FROM d1), 'created', '(CRIAR) devolve created');

SELECT is(
  (SELECT source FROM public.deals WHERE id = ((SELECT j->'deal'->>'id' FROM d1))::uuid),
  'api',
  '(PROCEDÊNCIA) o Negócio nasceu marcado como api — é o buraco que o ADR-0030 §4 fecha');

SELECT is(
  (SELECT count(*) FROM public.pipeline_entries
    WHERE deal_id = ((SELECT j->'deal'->>'id' FROM d1))::uuid),
  1::bigint,
  '(CRIAR) nasceu UMA posição ligada ao Negócio — identidade e posição na mesma transação');

-- Primeiro Negócio não avisa nada. Sem esta asserção, um aviso que viesse
-- SEMPRE passaria despercebido na asserção seguinte.
SELECT ok(
  (SELECT j->'warning' FROM d1) IS NULL,
  '(CONTROLE) primeiro Negócio no funil NÃO traz aviso');

-- ===========================================================================
-- (AVISO) segundo Negócio aberto no mesmo funil: CRIA e sinaliza
-- ===========================================================================
CREATE TEMP TABLE d2 AS
SELECT public.api_create_deal(
  'deadbeef-0000-4000-8000-0000000000f1',
  'deadbeef-0000-4000-8000-0000000000fa',
  'whatsapp', 'novo', NULL, NULL, 'Segundo Negócio', NULL, 'api', 'dk-2') AS j;

SELECT is((SELECT j->>'status' FROM d2), 'created',
  '(AVISO) o segundo é CRIADO — é assim que recompra se representa (ADR-0023 decisão 2)');

SELECT is(
  (SELECT j->'warning'->>'code' FROM d2), 'lead_has_open_deal_in_pipeline',
  '(AVISO) e vem sinalizado');

SELECT is(
  (SELECT j->'warning'->>'open_deal_id' FROM d2), (SELECT j->'deal'->>'id' FROM d1),
  '(AVISO) o aviso aponta o Negócio que JÁ estava aberto, não o recém-criado');

SELECT is(
  (SELECT count(*) FROM public.deals
    WHERE source_lead_id = 'deadbeef-0000-4000-8000-0000000000fa' AND closed_at IS NULL),
  2::bigint,
  '(AVISO) existem DOIS Negócios abertos — o aviso não impediu, só avisou');

-- ===========================================================================
-- (IDEMPOTÊNCIA)
-- ===========================================================================
CREATE TEMP TABLE d3 AS
SELECT public.api_create_deal(
  'deadbeef-0000-4000-8000-0000000000f1',
  'deadbeef-0000-4000-8000-0000000000fa',
  'whatsapp', 'novo', NULL, NULL, 'Retentativa', NULL, 'api', 'dk-1') AS j;

SELECT is((SELECT j->>'status' FROM d3), 'replayed', '(IDEMPOTÊNCIA) mesma chave devolve replayed');

SELECT is(
  (SELECT j->'deal'->>'id' FROM d3), (SELECT j->'deal'->>'id' FROM d1),
  '(IDEMPOTÊNCIA) replay devolve o MESMO Negócio, não um terceiro');

SELECT is(
  (SELECT count(*) FROM public.deals
    WHERE source_lead_id = 'deadbeef-0000-4000-8000-0000000000fa'),
  2::bigint,
  '(IDEMPOTÊNCIA) a retentativa não criou nada — seguem DOIS');

-- ===========================================================================
-- (PORTA) a delegação preserva o que abrir_negocio recusa
-- ===========================================================================
SELECT throws_ok(
  $$ SELECT public.api_create_deal(
       'deadbeef-0000-4000-8000-0000000000f1',
       'deadbeef-0000-4000-8000-0000000000fa',
       'upsell', 'novo') $$,
  '22023', NULL,
  '(PORTA) Carteira NÃO abre por esta porta (ADR-0023 decisão 8) — a delegação preserva a recusa');

SELECT throws_ok(
  $$ SELECT public.api_create_deal(
       'deadbeef-0000-4000-8000-0000000000f1',
       'deadbeef-0000-4000-8000-0000000000fa',
       'whatsapp', 'novo', NULL, NULL, NULL, NULL, 'robo') $$,
  '22023', NULL,
  '(PROCEDÊNCIA) valor fora do vocabulário é recusado com mensagem, não com erro de constraint');

ROLLBACK;
