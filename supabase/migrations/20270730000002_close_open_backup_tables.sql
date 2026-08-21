-- 20270730000002_close_open_backup_tables.sql
--
-- EXPOSIÇÃO ABERTA, fechada em 2026-07-30. Quatro tabelas de backup no schema
-- `public` estavam legíveis por `anon` — qualquer um com a chave pública do
-- frontend, SEM LOGIN — e graváveis/truncáveis por qualquer usuário autenticado
-- de qualquer organização.
--
--   tabela                                  linhas   anon      authenticated
--   _backup_stage_faxina_20260727               25   SELECT    SELECT/INSERT/UPDATE/DELETE/TRUNCATE
--   _backup_workflows_faxina_20260727           10   SELECT    idem
--   _backup_wf_executions_faxina_20260727    1.475   SELECT    idem
--   backup_chique_oportunidades_20260729     3.912   SELECT    idem
--
-- CAUSA
-- -----
-- `CREATE TABLE ... AS` rodado à mão em script de faxina
-- (supabase/scripts/cleanup-chique-oportunidades-2026-07-29.sql:60 e similares).
-- CORREÇÃO DE MECANISMO (2026-08-11): esta explicação estava ERRADA e ficou no
-- repositório ensinando o mecanismo errado. Postgres NÃO tem herança de
-- privilégio de TABELA a partir de GRANT de SCHEMA — GRANT em schema concede
-- apenas USAGE e CREATE. Privilégio de tabela vem de GRANT explícito ou de
-- ALTER DEFAULT PRIVILEGES no momento da criação, e é este o caso aqui:
--
--   public | postgres       | r | anon=rxtm/postgres
--   public | supabase_admin | r | anon=arwdDxtm/supabase_admin
--
-- Ou seja, TODA tabela criada por `postgres` em `public` nasce com privilégio
-- para `anon` e `authenticated`, qualquer que seja o comando — não é o
-- `CREATE TABLE AS` que causa, é criar tabela em `public` como `postgres`.
-- Reproduzido em transação revertida. A distinção importa: com a explicação
-- errada, isto parece descuido humano evitável; com a certa, é default inseguro
-- que exige gate automático (ver INV-5).
--
-- Quem cria backup assim não escolhe expor — expõe por omissão, e o nome com
-- prefixo `_backup_` dá a sensação oposta, de coisa interna.
--
-- POR QUE O CI NÃO PEGOU
-- ----------------------
-- O invariante INV-3 (`supabase/tests/rls_invariants.sql`) roda contra um schema
-- construído a partir de `supabase/migrations/`. Estas quatro tabelas nunca
-- passaram por migration: nasceram direto em produção. O gate é cego para
-- objeto que só existe em prod — é uma lacuna do gate, não um descuido dele.
--
-- Esta migration existe para que o repo passe a conhecer as quatro. Em produção
-- já foi aplicada (MCP, 2026-07-30). Dado NÃO é tocado: só privilégio e RLS.
--
-- ROLLBACK pareado: rollback/20270730000002_close_open_backup_tables.sql

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    '_backup_stage_faxina_20260727',
    '_backup_workflows_faxina_20260727',
    '_backup_wf_executions_faxina_20260727',
    'backup_chique_oportunidades_20260729'
  ] LOOP
    -- IF EXISTS porque são objetos de produção: um banco recriado do zero a
    -- partir das migrations não os tem, e a migration não pode quebrar por isso.
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    END IF;
  END LOOP;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.backup_chique_oportunidades_20260729') IS NOT NULL THEN
    COMMENT ON TABLE public.backup_chique_oportunidades_20260729 IS
      'Backup da faxina de oportunidades da Chique (29/07). RLS deny-all + zero '
      'GRANT desde 30/07 — nasceu legível por anon por herança de privilégio do '
      'schema public.';
  END IF;
END
$$;
