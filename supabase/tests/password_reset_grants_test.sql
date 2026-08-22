-- ============================================================================
-- password_reset_tokens / auth_rate_limits — CONTRATO DE PRIVILÉGIO
-- ============================================================================
--
-- Por que este arquivo existe (SCRUM-424):
--
-- A suíte tests/integration/password-reset-flow.test.ts falha CINCO vezes com
-- `mint token: permission denied for table password_reset_tokens`, e o erro é
-- 42501 — falta de GRANT, não RLS (RLS negando INSERT diria "new row violates
-- row-level security policy"). Só que:
--
--   • o baseline concede: `GRANT ALL ON TABLE "public"."password_reset_tokens"
--     TO "service_role"` (20260101000000_baseline_prod_schema.sql:45462);
--   • produção CONCEDE de fato — `aclexplode(relacl)` devolve as 8 privilegia-
--     ções para service_role (medido 2026-08-21 via pg_class, não via
--     information_schema, que só mostra o que o papel corrente enxerga);
--   • nenhuma migration do repo revoga nada dessa tabela;
--   • o cliente do teste É service_role (as RPCs que só ele pode executar
--     passam na mesma suíte), e nenhuma OUTRA tabela dá permission denied.
--
-- Ou seja: leitura de arquivo não fecha o caso. Este teste MEDE o banco que o
-- CI constrói. O `diag` abaixo imprime a ACL crua no log do job, e é o dado que
-- faltava; as asserções fixam o contrato que a tabela deve ter para sempre:
-- service_role escreve, anon e authenticated não enxergam nada.
--
-- O contrato em si não é opcional: as edge functions forgot-password e
-- reset-password gravam e leem a tabela com a service key, e o COMMENT ON TABLE
-- do baseline já o declara ("RLS deny-all by design: no policies, no
-- anon/authenticated grants — only service_role").
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(10);

-- ---------------------------------------------------------------------------
-- diagnóstico: a ACL crua das duas tabelas, no log do job
-- ---------------------------------------------------------------------------
SELECT diag(
  'ACL password_reset_tokens = ' || COALESCE(
    (SELECT c.relacl::text FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'password_reset_tokens'),
    '<NULL — ACL default, nenhum GRANT explícito sobreviveu>')
);

SELECT diag(
  'ACL auth_rate_limits = ' || COALESCE(
    (SELECT c.relacl::text FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'auth_rate_limits'),
    '<NULL — ACL default, nenhum GRANT explícito sobreviveu>')
);

SELECT diag(
  'service_role: rolbypassrls = ' || COALESCE(
    (SELECT rolbypassrls::text FROM pg_roles WHERE rolname = 'service_role'),
    '<papel service_role NÃO EXISTE>')
);

-- ---------------------------------------------------------------------------
-- 1-2. as tabelas existem
-- ---------------------------------------------------------------------------
SELECT has_table('public', 'password_reset_tokens',
  'password_reset_tokens existe (vem do baseline)');
SELECT has_table('public', 'auth_rate_limits',
  'auth_rate_limits existe (vem do baseline)');

-- ---------------------------------------------------------------------------
-- 3-6. service_role escreve — é disso que as edge functions dependem
-- ---------------------------------------------------------------------------
SELECT ok(has_table_privilege('service_role', 'public.password_reset_tokens', 'INSERT'),
  'service_role tem INSERT em password_reset_tokens (forgot-password grava o hash)');
SELECT ok(has_table_privilege('service_role', 'public.password_reset_tokens', 'SELECT'),
  'service_role tem SELECT em password_reset_tokens (o INSERT ... RETURNING precisa)');
SELECT ok(has_table_privilege('service_role', 'public.password_reset_tokens', 'DELETE'),
  'service_role tem DELETE em password_reset_tokens (expurgo de token vencido)');
SELECT ok(has_table_privilege('service_role', 'public.auth_rate_limits', 'INSERT'),
  'service_role tem INSERT em auth_rate_limits');

-- ---------------------------------------------------------------------------
-- 7-10. anon e authenticated não enxergam NADA — deny-all por desenho
-- ---------------------------------------------------------------------------
SELECT ok(NOT has_table_privilege('anon', 'public.password_reset_tokens', 'SELECT'),
  'anon NÃO lê password_reset_tokens');
SELECT ok(NOT has_table_privilege('authenticated', 'public.password_reset_tokens', 'SELECT'),
  'authenticated NÃO lê password_reset_tokens');
SELECT ok(NOT has_table_privilege('anon', 'public.auth_rate_limits', 'SELECT'),
  'anon NÃO lê auth_rate_limits');
SELECT ok(NOT has_table_privilege('authenticated', 'public.auth_rate_limits', 'SELECT'),
  'authenticated NÃO lê auth_rate_limits');

SELECT * FROM finish();
ROLLBACK;
