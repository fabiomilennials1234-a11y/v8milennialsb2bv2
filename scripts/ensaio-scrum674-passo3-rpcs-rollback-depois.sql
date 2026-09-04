-- Exige restauração byte a byte do corpo e dos atributos de segurança.
DO $$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN _ensaio674_rollback b ON b.proname = p.proname
  WHERE n.nspname = 'public'
    AND (
      md5(p.prosrc) IS DISTINCT FROM b.body_hash
      OR COALESCE(p.proacl::text, '<null>') IS DISTINCT FROM b.acl
      OR p.prosecdef IS DISTINCT FROM b.prosecdef
      OR COALESCE(p.proconfig::text, '<null>') IS DISTINCT FROM b.config
    );

  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'REPROVOU rollback: % funções divergiram do PROD original', v_bad;
  END IF;

  RAISE EXCEPTION 'ENSAIO_OK SCRUM-674 rollback janela 1: 4/4 corpos e atributos restaurados';
END $$;

ROLLBACK;
