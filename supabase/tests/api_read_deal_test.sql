-- supabase/tests/api_read_deal_test.sql
--
-- Ticket #1767 — `api_list_deals` e `api_get_deal`.
--
-- Duas coisas que só o banco prova, e que a suíte de rota (dublê) não alcança:
--
--   1. **O keyset pagina de verdade.** Dublê devolve o que você mandou; só uma
--      base com linhas reais mostra se a segunda página continua de onde a
--      primeira parou, sem repetir nem pular. É por isso que este arquivo monta
--      Negócios com a MESMA última atividade — o caso em que um cursor sem
--      desempate por id quebra, e o único em que ele quebra.
--
--   2. **O recorte por inquilino.** As funções são SECURITY DEFINER e recebem a
--      organização por parâmetro. Se o recorte no corpo falhar, a chave de uma
--      org lê o funil da outra.
--
-- Run: bash supabase/tests/run.sh
-- Roda inteiro em transação revertida.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- ===========================================================================
-- (ACL)
-- ===========================================================================
SELECT is(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('api_list_deals','api_get_deal')
      AND (has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0::bigint,
  '(ACL) nem anon nem authenticated executam a leitura de Negócio');

-- ===========================================================================
-- Fixtures: duas orgs; três Negócios na A, um deles com a MESMA última
-- atividade de outro (o caso que quebra cursor sem desempate)
-- ===========================================================================
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('deadbeef-0000-4000-8000-00000000ab01', 'Org Read A', 'org-read-a', 'America/Sao_Paulo'),
  ('deadbeef-0000-4000-8000-00000000ab02', 'Org Read B', 'org-read-b', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name) VALUES
  ('deadbeef-0000-4000-8000-00000000ab0a', 'deadbeef-0000-4000-8000-00000000ab01', 'Lead RA'),
  ('deadbeef-0000-4000-8000-00000000ab0b', 'deadbeef-0000-4000-8000-00000000ab02', 'Lead RB')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipelines (id, organization_id, name, slug, type) VALUES
  ('deadbeef-0000-4000-8000-00000000ab0c', 'deadbeef-0000-4000-8000-00000000ab01', 'Qualificação', 'whatsapp', 'system'),
  ('deadbeef-0000-4000-8000-00000000ab0d', 'deadbeef-0000-4000-8000-00000000ab01', 'Propostas', 'propostas', 'system')
ON CONFLICT (id) DO NOTHING;

-- d1 e d2 EMPATAM na última atividade. d3 é mais antigo. dB é da org vizinha.
INSERT INTO public.deals (id, organization_id, source_lead_id, title, source, last_activity_at, closed_at, won) VALUES
  ('deadbeef-0000-4000-8000-00000000ad01', 'deadbeef-0000-4000-8000-00000000ab01', 'deadbeef-0000-4000-8000-00000000ab0a', 'N1', 'api',      '2026-08-10T00:00:00Z', NULL, NULL),
  ('deadbeef-0000-4000-8000-00000000ad02', 'deadbeef-0000-4000-8000-00000000ab01', 'deadbeef-0000-4000-8000-00000000ab0a', 'N2', 'human',    '2026-08-10T00:00:00Z', NULL, NULL),
  ('deadbeef-0000-4000-8000-00000000ad03', 'deadbeef-0000-4000-8000-00000000ab01', 'deadbeef-0000-4000-8000-00000000ab0a', 'N3', 'workflow', '2026-08-01T00:00:00Z', '2026-08-05T00:00:00Z', true),
  ('deadbeef-0000-4000-8000-00000000ad0b', 'deadbeef-0000-4000-8000-00000000ab02', 'deadbeef-0000-4000-8000-00000000ab0b', 'NB', 'api',      '2026-08-11T00:00:00Z', NULL, NULL);

INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key, deal_id) VALUES
  ('deadbeef-0000-4000-8000-00000000ae01', 'deadbeef-0000-4000-8000-00000000ab01', 'deadbeef-0000-4000-8000-00000000ab0c', 'deadbeef-0000-4000-8000-00000000ab0a', 'novo',    'deadbeef-0000-4000-8000-00000000ad01'),
  ('deadbeef-0000-4000-8000-00000000ae02', 'deadbeef-0000-4000-8000-00000000ab01', 'deadbeef-0000-4000-8000-00000000ab0d', 'deadbeef-0000-4000-8000-00000000ab0a', 'enviada', 'deadbeef-0000-4000-8000-00000000ad02'),
  ('deadbeef-0000-4000-8000-00000000ae03', 'deadbeef-0000-4000-8000-00000000ab01', 'deadbeef-0000-4000-8000-00000000ab0c', 'deadbeef-0000-4000-8000-00000000ab0a', 'abordado','deadbeef-0000-4000-8000-00000000ad03');

SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- (TENANT) a asserção que a ausência de RLS obriga
-- ===========================================================================
SELECT is(
  (SELECT count(*) FROM public.api_list_deals('deadbeef-0000-4000-8000-00000000ab01')),
  3::bigint,
  '(TENANT) a org A enxerga os TRÊS dela');

SELECT is(
  (SELECT count(*) FROM public.api_list_deals('deadbeef-0000-4000-8000-00000000ab02')),
  1::bigint,
  '(TENANT) a org B enxerga só o dela — nada atravessa');

SELECT ok(
  (SELECT public.api_get_deal(
     'deadbeef-0000-4000-8000-00000000ab01',        -- org A
     'deadbeef-0000-4000-8000-00000000ad0b')) IS NULL,  -- Negócio da org B
  '(TENANT) ler Negócio alheio devolve NULL — indistinguível de inexistente');

SELECT ok(
  (SELECT public.api_get_deal(
     'deadbeef-0000-4000-8000-00000000ab01',
     'deadbeef-0000-4000-8000-00000000ad01')) IS NOT NULL,
  '(CONTROLE) e o Negócio da própria org É devolvido — o recorte não recusa tudo');

-- ===========================================================================
-- (CORPO) posição e Procedência chegam sem segunda chamada
-- ===========================================================================
SELECT is(
  (SELECT (public.api_get_deal('deadbeef-0000-4000-8000-00000000ab01',
                               'deadbeef-0000-4000-8000-00000000ad01'))->>'pipeline_slug'),
  'whatsapp',
  '(CORPO) a posição vem junto — o funil');

SELECT is(
  (SELECT (public.api_get_deal('deadbeef-0000-4000-8000-00000000ab01',
                               'deadbeef-0000-4000-8000-00000000ad01'))->>'stage_key'),
  'novo',
  '(CORPO) e a etapa');

SELECT is(
  (SELECT (public.api_get_deal('deadbeef-0000-4000-8000-00000000ab01',
                               'deadbeef-0000-4000-8000-00000000ad03'))->>'source'),
  'workflow',
  '(CORPO) a Procedência chega a quem integra — é o ADR-0030 §4 saindo de dentro');

-- ===========================================================================
-- (FILTROS)
-- ===========================================================================
SELECT is(
  (SELECT count(*) FROM public.api_list_deals('deadbeef-0000-4000-8000-00000000ab01', 'propostas')),
  1::bigint,
  '(FILTRO) por funil');

SELECT is(
  (SELECT count(*) FROM public.api_list_deals('deadbeef-0000-4000-8000-00000000ab01', NULL, 'abordado')),
  1::bigint,
  '(FILTRO) por etapa');

SELECT is(
  (SELECT count(*) FROM public.api_list_deals('deadbeef-0000-4000-8000-00000000ab01', NULL, NULL, NULL, 'open')),
  2::bigint,
  '(FILTRO) situação aberta exclui o fechado');

SELECT is(
  (SELECT count(*) FROM public.api_list_deals('deadbeef-0000-4000-8000-00000000ab01', NULL, NULL, NULL, 'won')),
  1::bigint,
  '(FILTRO) situação ganha traz só o ganho');

-- ===========================================================================
-- (KEYSET) o caso que quebra cursor sem desempate: EMPATE na última atividade
-- ===========================================================================
-- Página 1, uma linha só.
CREATE TEMP TABLE pg1 AS
SELECT id, last_activity_at
  FROM public.api_list_deals('deadbeef-0000-4000-8000-00000000ab01', NULL, NULL, NULL, NULL, 1);

-- Página 2, continuando do cursor da página 1.
CREATE TEMP TABLE pg2 AS
SELECT id, last_activity_at
  FROM public.api_list_deals('deadbeef-0000-4000-8000-00000000ab01', NULL, NULL, NULL, NULL, 1,
        (SELECT last_activity_at FROM pg1), (SELECT id FROM pg1));

CREATE TEMP TABLE pg3 AS
SELECT id, last_activity_at
  FROM public.api_list_deals('deadbeef-0000-4000-8000-00000000ab01', NULL, NULL, NULL, NULL, 1,
        (SELECT last_activity_at FROM pg2), (SELECT id FROM pg2));

SELECT isnt(
  (SELECT id FROM pg2), (SELECT id FROM pg1),
  '(KEYSET) a página 2 NÃO repete a linha da página 1, mesmo com a última atividade EMPATADA');

SELECT is(
  (SELECT count(DISTINCT id) FROM (
     SELECT id FROM pg1 UNION ALL SELECT id FROM pg2 UNION ALL SELECT id FROM pg3) q),
  3::bigint,
  '(KEYSET) três páginas de uma linha percorrem os três Negócios — nenhum repetido, nenhum pulado');

-- CONTROLE: sem cursor, a primeira página traz a linha mais recente.
SELECT is(
  (SELECT last_activity_at FROM pg1),
  '2026-08-10T00:00:00Z'::timestamptz,
  '(CONTROLE) a ordenação é por última atividade DESC — a primeira página traz a mais recente');

ROLLBACK;
