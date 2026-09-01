-- supabase/tests/oraculo_onda2_catalogo_test.sql
--
-- Oráculo · Onda 2 — SCRUM-596, o catálogo de leitura estrutural.
-- ADR-0032 §4 (o Escopo é do servidor) e ADR-0017 (o caderno de vendas).
--
-- O que estas asserções guardam, em ordem de gravidade:
--
--   1. As quatro funções recebem a organização POR PARÂMETRO. Isso só é seguro
--      enquanto `authenticated` não puder executá-las — quem resolve o Escopo é
--      a edge function, a partir do JWT. Esta base já teve que revogar 14
--      funções com org por parâmetro alcançáveis por `authenticated`; estas
--      quatro não podem virar as próximas.
--   2. `anon` não alcança nenhuma delas. Grant de função volta para PUBLIC a
--      cada DROP+CREATE, então a asserção é permanente e não cerimonial.
--   3. Pergunta ampla não puxa a base inteira: período, dias e limite têm teto
--      DENTRO da função, e não só na ferramenta que a chama. Quem tiver a
--      credencial de service_role fala direto com a RPC.
--   4. `perdas` declara que não tem a dimensão motivo. Ferramenta que devolve
--      vazio em silêncio é onde o modelo preenche o buraco sozinho.
--   5. `leads` só aceita recorte de lista fechada — o modelo não escolhe o que
--      o banco filtra.
--
-- Run: psql "$DATABASE_URL" -f supabase/tests/oraculo_onda2_catalogo_test.sql
-- Roda inteiro em transação revertida.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- ── 1. As quatro existem ──────────────────────────────────────────────────
SELECT has_function('public', 'oraculo_funil',   ARRAY['uuid','uuid','integer'],
  '(CATÁLOGO) oraculo_funil existe');
SELECT has_function('public', 'oraculo_ranking', ARRAY['uuid','integer','integer'],
  '(CATÁLOGO) oraculo_ranking existe');
SELECT has_function('public', 'oraculo_perdas',  ARRAY['uuid','uuid','integer','integer'],
  '(CATÁLOGO) oraculo_perdas existe');
SELECT has_function('public', 'oraculo_leads',   ARRAY['uuid','uuid','text','integer','integer'],
  '(CATÁLOGO) oraculo_leads existe');

-- ── 2. Ninguém do lado do cliente executa ─────────────────────────────────
SELECT ok(NOT has_function_privilege('anon', 'public.oraculo_funil(uuid,uuid,integer)', 'EXECUTE'),
  '(SEGURANÇA) anon NÃO executa oraculo_funil');
SELECT ok(NOT has_function_privilege('anon', 'public.oraculo_ranking(uuid,integer,integer)', 'EXECUTE'),
  '(SEGURANÇA) anon NÃO executa oraculo_ranking');
SELECT ok(NOT has_function_privilege('anon', 'public.oraculo_perdas(uuid,uuid,integer,integer)', 'EXECUTE'),
  '(SEGURANÇA) anon NÃO executa oraculo_perdas');
SELECT ok(NOT has_function_privilege('anon', 'public.oraculo_leads(uuid,uuid,text,integer,integer)', 'EXECUTE'),
  '(SEGURANÇA) anon NÃO executa oraculo_leads');

SELECT ok(NOT has_function_privilege('authenticated', 'public.oraculo_funil(uuid,uuid,integer)', 'EXECUTE'),
  '(SEGURANÇA) authenticated NÃO executa oraculo_funil — org vem por parâmetro');
SELECT ok(NOT has_function_privilege('authenticated', 'public.oraculo_ranking(uuid,integer,integer)', 'EXECUTE'),
  '(SEGURANÇA) authenticated NÃO executa oraculo_ranking — org vem por parâmetro');
SELECT ok(NOT has_function_privilege('authenticated', 'public.oraculo_perdas(uuid,uuid,integer,integer)', 'EXECUTE'),
  '(SEGURANÇA) authenticated NÃO executa oraculo_perdas — org vem por parâmetro');
SELECT ok(NOT has_function_privilege('authenticated', 'public.oraculo_leads(uuid,uuid,text,integer,integer)', 'EXECUTE'),
  '(SEGURANÇA) authenticated NÃO executa oraculo_leads — org vem por parâmetro');

-- ── 3. service_role executa — senão a edge function não lê nada ───────────
SELECT ok(has_function_privilege('service_role', 'public.oraculo_funil(uuid,uuid,integer)', 'EXECUTE'),
  '(CONTRATO) service_role executa oraculo_funil');
SELECT ok(has_function_privilege('service_role', 'public.oraculo_ranking(uuid,integer,integer)', 'EXECUTE'),
  '(CONTRATO) service_role executa oraculo_ranking');
SELECT ok(has_function_privilege('service_role', 'public.oraculo_perdas(uuid,uuid,integer,integer)', 'EXECUTE'),
  '(CONTRATO) service_role executa oraculo_perdas');
SELECT ok(has_function_privilege('service_role', 'public.oraculo_leads(uuid,uuid,text,integer,integer)', 'EXECUTE'),
  '(CONTRATO) service_role executa oraculo_leads');

-- ── 4. Os tetos valem DENTRO da função ────────────────────────────────────
-- A ferramenta em Deno já limita, mas quem tiver a credencial de service_role
-- fala direto com a RPC. O teto na borda de fora não é teto.
SELECT is(
  (public.oraculo_funil('0aca0000-0000-4000-8000-000000000009'::uuid, NULL, 9999) ->> 'periodo_dias')::int,
  365,
  '(TETO) funil limita o período a 365 dias mesmo pedindo 9999');
SELECT is(
  (public.oraculo_perdas('0aca0000-0000-4000-8000-000000000009'::uuid, NULL, 9999, 5000) ->> 'periodo_dias')::int,
  365,
  '(TETO) perdas limita o período a 365 dias');
SELECT is(
  (public.oraculo_leads('0aca0000-0000-4000-8000-000000000009'::uuid, NULL, 'parados', 9999, 5000) ->> 'dias')::int,
  365,
  '(TETO) leads limita os dias a 365');

-- ── 5. `perdas` não finge ter motivo ──────────────────────────────────────
SELECT is(
  public.oraculo_perdas('0aca0000-0000-4000-8000-000000000009'::uuid, NULL, 30, 20) ->> 'motivo_disponivel',
  'false',
  '(HONESTIDADE) perdas declara que a dimensão motivo não existe nesta base');

-- ── 6. `leads` não aceita recorte inventado pelo modelo ───────────────────
SELECT is(
  public.oraculo_leads('0aca0000-0000-4000-8000-000000000009'::uuid, NULL, 'todos_da_base', 14, 20) ->> 'recorte',
  'parados',
  '(GUARDA) recorte fora da lista fechada cai no padrão, não vira consulta livre');
SELECT is(
  public.oraculo_leads('0aca0000-0000-4000-8000-000000000009'::uuid, NULL, 'sem_contato', 14, 20) ->> 'recorte',
  'sem_contato',
  '(GUARDA) recorte válido é respeitado — a guarda não é um carimbo fixo');

-- ── 7. O Escopo aparece na resposta ───────────────────────────────────────
-- Sem isto o Oráculo não sabe dizer se está olhando a organização ou só o que
-- a pessoa atende, e responde "a equipe está mal" olhando uma pessoa só.
SELECT is(
  public.oraculo_funil('0aca0000-0000-4000-8000-000000000009'::uuid, NULL, 30) ->> 'escopo',
  'organizacao',
  '(ESCOPO) team_member nulo é lido como organização');
SELECT is(
  public.oraculo_funil('0aca0000-0000-4000-8000-000000000009'::uuid,
                       '0aca0000-0000-4000-8000-00000000000a'::uuid, 30) ->> 'escopo',
  'pessoa',
  '(ESCOPO) team_member preenchido é lido como pessoa');

SELECT * FROM finish();
ROLLBACK;
