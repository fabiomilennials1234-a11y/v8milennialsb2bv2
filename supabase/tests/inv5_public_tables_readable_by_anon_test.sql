-- supabase/tests/inv5_public_tables_readable_by_anon_test.sql
--
-- INV-5 — nenhuma tabela de `public` é legível por `anon`/`authenticated` sem
-- RLS.
--
-- O DEFEITO QUE ORIGINOU O INVARIANTE
--
-- Seis tabelas `_bkp_%` nasceram à mão em produção (`CREATE TABLE AS` no editor
-- de SQL, durante duas intervenções distintas) e ficaram legíveis por `anon` —
-- a chave publicável que vai no bundle do front. Uma delas guardava
-- `uazapi_token`, credencial viva de envio; outras guardavam telefone, `lead_id`
-- e conteúdo de mensagem. Foi a terceira vez que a mesma classe de defeito
-- apareceu.
--
-- A causa não é a que o repositório contava. Não é "herda o GRANT do schema
-- public": é `ALTER DEFAULT PRIVILEGES`. Medido:
--
--   public | postgres       | r | anon=rxtm/postgres
--   public | supabase_admin | r | anon=arwdDxtm/supabase_admin
--
-- Toda tabela criada em `public` NASCE com SELECT para `anon`.
--
-- E esses defaults FICAM. Eles são load-bearing: o PostgREST atende `anon` e
-- `authenticated` porque essas roles têm GRANT de tabela, e quem faz o portão é
-- a RLS. Revogar o default global não conserta vazamento — derruba o produto.
-- Por isso o invariante não é "tabela não deve ter GRANT para anon", é **toda
-- tabela em `public` tem que ter RLS ligada**: o GRANT é o estado normal e
-- permanente, a RLS é o controle, e este é o ponto de imposição correto — o
-- único que exige segurança sem quebrar o acesso de que o produto depende.
--
-- O detector aceita `REVOKE` como conserto (CONSERTO 2, abaixo) porque para uma
-- tabela AVULSA — backup manual que ninguém deveria ler — revogar é legítimo. O
-- que não se faz é revogar no DEFAULT, que atinge toda tabela futura.
--
-- POR QUE O INV-3 NÃO PEGOU — três cegueiras, e a terceira é a que decide
--
--   (a) POPULAÇÃO: `_rls_inv_org_tables_without_rls()` só olha tabela COM
--       coluna `organization_id`. Três das seis não têm — inclusive as duas
--       maiores (16.869 telefones, 20.424 `remote_jid`). Estavam fora do
--       alcance por desenho, não por acidente.
--   (b) PREDICADO: INV-3 testa só `relrowsecurity`. Quem expõe é GRANT **e**
--       RLS desligada. RLS off sem grant não vaza; grant sem RLS vaza. INV-5
--       testa a conjunção, e as duas asserções de conserto abaixo provam que
--       ele lê os DOIS termos — desligar qualquer um dos dois limpa a violação.
--   (c) ONDE RODA: esta suíte corre contra um banco montado a partir de
--       `supabase/migrations/*`. Objeto criado à mão em produção NUNCA existe
--       aqui. Por isso este arquivo é metade da entrega: ele prova que o
--       detector MORDE, e a outra metade — o `pg_cron` que roda o mesmo
--       detector CONTRA PRODUÇÃO e escreve em `runtime_logs` — é o que teria
--       encontrado estas seis. Só a suíte seria teatro para este achado.
--
-- Por isso as asserções vêm em pares: o hard-0 (o schema real está limpo) E a
-- falha plantada (o detector acusa quando há o quê acusar). Invariante sem
-- prova de que morde é decoração — o hard-0 sozinho passa verde tanto com um
-- detector correto quanto com um detector que nunca devolve linha.
--
-- Run: supabase start && bash supabase/tests/run.sh
-- Roda inteiro em transação revertida — não muta o banco.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

SET LOCAL role postgres;

-- ===========================================================================
-- (PRECONDIÇÃO) o escopo do invariante se defende sozinho.
--
-- INV-5 olha `relkind = 'r'` — tabela ordinária. Duas outras coisas em `public`
-- podem guardar linha e receber GRANT, e o detector é CEGO para as duas:
--
--   'p' (particionada) — o pai não guarda linha, mas SELECT no pai lê as
--       partições. Pai sem RLS com GRANT vivo vaza, e INV-5 não vê.
--   'm' (matview)      — pior: matview NÃO ACEITA RLS. Não existe `ENABLE ROW
--       LEVEL SECURITY` para ela, então incluí-la mudaria o significado de
--       "conserto" neste arquivo: o CONSERTO 1 abaixo deixaria de valer
--       universalmente, e teste cujo conserto vale "quase sempre" é pior que
--       teste com escopo declarado.
--
-- Medido em 11/08: `public` tem 279 relações no schema deste repositório e 289
-- em produção — TODAS 'r' nos dois. Zero particionada, zero matview. Ampliar o
-- predicado hoje seria escrever regra para caso que não existe, sem exemplo
-- real para exercitar.
--
-- Daí esta asserção, em vez de uma nota de rodapé: comentário envelhece,
-- asserção não. No dia em que a primeira matview ou tabela particionada nascer
-- em `public`, este teste fica VERMELHO e força a decisão NAQUELE momento — com
-- o exemplo em mãos, que é exatamente o que falta hoje.
-- ===========================================================================
SELECT is(
  (SELECT count(*)::int
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('p', 'm')),
  0,
  '(PRECONDIÇÃO) public só tem tabela ordinária — se quebrar: nasceu relação que INV-5 NÃO cobre (particionada ou matview). Decidir ali: ampliar o detector (matview não aceita RLS, então o conserto muda) ou excluir a relação explicitamente. Não deixar passar em silêncio');

-- ===========================================================================
-- (HARD-0) o schema montado das migrations não tem NENHUMA violação.
--
-- Zero-tolerância desde o primeiro dia, sem ratchet e sem dívida herdada:
-- medido antes de escrever a migration, o repositório já estava em 0. Um
-- invariante que nasce com teto herdado nunca desce; este não precisa.
-- ===========================================================================
SELECT is(
  (SELECT count(*)::int FROM public.inv_public_tables_readable_by_anon()),
  0,
  '(HARD-0) nenhuma tabela de public é legível por anon/authenticated sem RLS');

-- ===========================================================================
-- (PLANTADA) o vetor REAL, não uma aproximação.
--
-- `CREATE TABLE AS` é exatamente o que a mão humana fez em produção nas duas
-- intervenções. Nenhum GRANT explícito é escrito aqui — se a tabela sair
-- legível por anon, é o default privilege agindo, que é a causa que se quer
-- pegar.
-- ===========================================================================
CREATE TABLE public._inv5_planted_bkp AS
  SELECT id, name FROM public.organizations LIMIT 0;

SELECT is(
  (SELECT count(*)::int FROM public.inv_public_tables_readable_by_anon()
    WHERE tablename = '_inv5_planted_bkp'),
  2,
  '(PLANTADA) o detector acusa a tabela recém-criada — uma linha por grantee exposto');

SELECT ok(
  EXISTS (SELECT 1 FROM public.inv_public_tables_readable_by_anon()
           WHERE tablename = '_inv5_planted_bkp' AND grantee = 'anon'),
  '(PLANTADA) acusa `anon` — a chave publicável que vai no bundle do front');

SELECT ok(
  EXISTS (SELECT 1 FROM public.inv_public_tables_readable_by_anon()
           WHERE tablename = '_inv5_planted_bkp' AND grantee = 'authenticated'),
  '(PLANTADA) acusa `authenticated` — sem RLS, um usuário de QUALQUER org lê a tabela inteira');

-- ===========================================================================
-- (CONSERTO 1) ligar RLS limpa a violação.
-- ===========================================================================
ALTER TABLE public._inv5_planted_bkp ENABLE ROW LEVEL SECURITY;

SELECT is(
  (SELECT count(*)::int FROM public.inv_public_tables_readable_by_anon()
    WHERE tablename = '_inv5_planted_bkp'),
  0,
  '(CONSERTO 1) ligar RLS limpa — RLS é mitigação aceita mesmo com o GRANT de pé');

-- ===========================================================================
-- (REGRESSÃO) desligar de novo volta a acusar.
--
-- Prova que o detector lê o ESTADO a cada chamada, e não um carimbo de quando
-- a tabela foi criada. Sem esta, um detector que só olhasse tabelas novas
-- passaria em tudo acima.
-- ===========================================================================
ALTER TABLE public._inv5_planted_bkp DISABLE ROW LEVEL SECURITY;

SELECT is(
  (SELECT count(*)::int FROM public.inv_public_tables_readable_by_anon()
    WHERE tablename = '_inv5_planted_bkp'),
  2,
  '(REGRESSÃO) desligar a RLS volta a acusar — o detector lê o estado, não um carimbo');

-- ===========================================================================
-- (CONSERTO 2) o OUTRO termo: revogar o SELECT também limpa, com a RLS ainda
-- desligada.
--
-- Este par (CONSERTO 1 / CONSERTO 2) é o que prova que o predicado é uma
-- conjunção honesta. Um detector que olhasse só `relrowsecurity` — o INV-3 —
-- passaria no CONSERTO 1 e FALHARIA aqui.
-- ===========================================================================
REVOKE SELECT ON public._inv5_planted_bkp FROM anon, authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.inv_public_tables_readable_by_anon()
    WHERE tablename = '_inv5_planted_bkp'),
  0,
  '(CONSERTO 2) REVOKE limpa mesmo com RLS desligada — o predicado lê os DOIS termos, não só a RLS');

-- ===========================================================================
-- (GRANTS) quem pode rodar o detector.
--
-- Nome por nome, porque `rls_invariants` NÃO cobre grant de função: o detector
-- enumera a superfície exposta do banco inteiro, então ele mesmo não pode ser
-- legível por quem se quer manter do lado de fora.
-- ===========================================================================
SELECT ok(NOT has_function_privilege('anon',
  'public.inv_public_tables_readable_by_anon()', 'EXECUTE'),
  '(GRANT) anon NÃO executa o detector');
SELECT ok(NOT has_function_privilege('authenticated',
  'public.inv_public_tables_readable_by_anon()', 'EXECUTE'),
  '(GRANT) authenticated NÃO executa o detector');
SELECT ok(has_function_privilege('service_role',
  'public.inv_public_tables_readable_by_anon()', 'EXECUTE'),
  '(GRANT) service_role executa o detector');

SELECT ok(NOT has_function_privilege('anon',
  'public.inv_scan_public_tables_readable_by_anon()', 'EXECUTE'),
  '(GRANT) anon NÃO executa a varredura');
SELECT ok(NOT has_function_privilege('authenticated',
  'public.inv_scan_public_tables_readable_by_anon()', 'EXECUTE'),
  '(GRANT) authenticated NÃO executa a varredura');
SELECT ok(has_function_privilege('service_role',
  'public.inv_scan_public_tables_readable_by_anon()', 'EXECUTE'),
  '(GRANT) service_role executa a varredura');

-- ===========================================================================
-- (CRON) a varredura está agendada.
-- ===========================================================================
SELECT ok(
  EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'inv5-public-tables-readable-by-anon'),
  '(CRON) o job existe — detector sem agenda não roda contra produção');

SELECT is(
  (SELECT schedule FROM cron.job WHERE jobname = 'inv5-public-tables-readable-by-anon'),
  '17 4 * * *',
  '(CRON) roda 1x por dia');

-- ===========================================================================
-- (ALARME) o comando LITERAL registrado em cron.job, não uma cópia reescrita.
--
-- Copiar o comando da migration para cá provaria que a cópia funciona. O que
-- precisa ser provado é que o que está AGENDADO funciona.
-- ===========================================================================

-- Estado limpo: `_inv5_planted_bkp` acabou de ser consertada no CONSERTO 2.
DO $roda$
DECLARE v_cmd text;
BEGIN
  SELECT command INTO v_cmd FROM cron.job
   WHERE jobname = 'inv5-public-tables-readable-by-anon';
  IF v_cmd IS NULL THEN
    RAISE EXCEPTION 'inv5-public-tables-readable-by-anon não está em cron.job — nada para testar';
  END IF;
  EXECUTE v_cmd;
END
$roda$;

SELECT is(
  (SELECT count(*)::int FROM public.runtime_logs
    WHERE module = 'seguranca' AND action = 'inv5_tabela_publica_legivel_por_anon'),
  0,
  '(ALARME) banco limpo NÃO escreve nada — silêncio é o estado normal, senão o alarme vira ruído e ninguém lê');

-- Agora suja de novo — mesma tabela, só devolvendo o SELECT a anon.
GRANT SELECT ON public._inv5_planted_bkp TO anon;

DO $roda$
DECLARE v_cmd text;
BEGIN
  SELECT command INTO v_cmd FROM cron.job
   WHERE jobname = 'inv5-public-tables-readable-by-anon';
  EXECUTE v_cmd;
END
$roda$;

SELECT is(
  (SELECT count(*)::int FROM public.runtime_logs
    WHERE module = 'seguranca' AND action = 'inv5_tabela_publica_legivel_por_anon'),
  1,
  '(ALARME) com violação, a varredura escreve UMA linha — uma por passada, não uma por tabela');

SELECT is(
  (SELECT status FROM public.runtime_logs
    WHERE module = 'seguranca' AND action = 'inv5_tabela_publica_legivel_por_anon'),
  'error',
  '(ALARME) a linha entra como `error` — é vazamento de dado, não informação de rotina');

SELECT ok(
  (SELECT payload_snapshot -> 'violacoes' @> '[{"tabela": "_inv5_planted_bkp"}]'
     FROM public.runtime_logs
    WHERE module = 'seguranca' AND action = 'inv5_tabela_publica_legivel_por_anon'),
  '(ALARME) o payload nomeia a tabela — alarme que não diz QUAL tabela obriga a refazer a varredura à mão');

SELECT is(
  (SELECT (payload_snapshot ->> 'total')::int FROM public.runtime_logs
    WHERE module = 'seguranca' AND action = 'inv5_tabela_publica_legivel_por_anon'),
  1,
  '(ALARME) o payload conta as violações');

SELECT ok(
  (SELECT organization_id IS NULL FROM public.runtime_logs
    WHERE module = 'seguranca' AND action = 'inv5_tabela_publica_legivel_por_anon'),
  '(ALARME) sem organization_id — a superfície exposta do banco não pertence a tenant nenhum');

SELECT * FROM finish();
ROLLBACK;
