BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(10);

SELECT hasnt_table('public', 'oraculo_usage', '(CONTRATO) tabela ativa do chat antigo não existe');
SELECT has_table('public', 'oraculo_legacy_usage_archive', '(AUDIT) histórico antigo foi preservado');
SELECT ok(to_regprocedure('public.check_oraculo_limit(uuid)') IS NULL, '(QUOTA) RPC de três perguntas não existe');
SELECT ok(to_regprocedure('public.record_oraculo_usage(uuid,uuid,text,text)') IS NULL, '(QUOTA) escritor antigo não existe');
SELECT has_index('public', 'oraculo_legacy_usage_archive', 'idx_oraculo_legacy_usage_archive_user_date', '(AUDIT) índice por usuário preservado');
SELECT has_index('public', 'oraculo_legacy_usage_archive', 'idx_oraculo_legacy_usage_archive_org', '(AUDIT) índice por organização preservado');
SELECT is(
  (SELECT count(*)::integer FROM pg_policies WHERE schemaname = 'public' AND tablename = 'oraculo_legacy_usage_archive'),
  0,
  '(SECURITY) arquivo não herda policies de produto'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.oraculo_legacy_usage_archive', 'SELECT'),
  '(SECURITY) usuário autenticado não lê arquivo'
);
SELECT ok(
  has_table_privilege('service_role', 'public.oraculo_legacy_usage_archive', 'SELECT'),
  '(OPS) backend pode ler arquivo para auditoria'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.oraculo_legacy_usage_archive'::regclass),
  '(SECURITY) RLS continua habilitada no arquivo'
);

SELECT * FROM finish();
ROLLBACK;
