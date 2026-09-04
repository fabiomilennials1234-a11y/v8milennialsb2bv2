-- Baseline para provar o rollback dedicado da janela 1.
BEGIN;

CREATE TEMP TABLE _ensaio674_rollback AS
SELECT p.proname,
       md5(p.prosrc) AS body_hash,
       COALESCE(p.proacl::text, '<null>') AS acl,
       p.prosecdef,
       COALESCE(p.proconfig::text, '<null>') AS config
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'abrir_negocio', 'create_lead_with_pipe',
    'create_lead_from_social_conversation', 'import_lead_into_custom_pipeline'
  );

DO $$
BEGIN
  IF (SELECT count(*) FROM _ensaio674_rollback) <> 4 THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: baseline não encontrou 4 RPCs';
  END IF;
END $$;
