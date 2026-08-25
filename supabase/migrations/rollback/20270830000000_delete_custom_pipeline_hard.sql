-- ROLLBACK de 20270830000000_delete_custom_pipeline_hard.sql
--
-- A migration só CRIA duas funções — não altera tabela, coluna, policy nem
-- dado. Desfazer é dropá-las.
--
-- ⚠️ O rollback NÃO desfaz exclusões já executadas. Um funil apagado pela RPC
-- não volta: `pipeline_stage_events` cai por CASCADE e não tem backup lógico.
-- Este arquivo devolve o SCHEMA ao estado anterior, não os dados.
--
-- ⚠️ Rodar isto com o front novo no ar quebra o botão "Excluir Funil" (a
-- chamada passa a devolver 42883, função inexistente). Reverta o front antes,
-- ou junto.

BEGIN;

DROP FUNCTION IF EXISTS public.delete_custom_pipeline(uuid);
DROP FUNCTION IF EXISTS public.custom_pipeline_delete_impact(uuid);

DO $do$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('delete_custom_pipeline', 'custom_pipeline_delete_impact');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FAIL: sobraram % função(ões) — o DROP não pegou.', v_n;
  END IF;
  RAISE NOTICE 'ROLLBACK OK: as duas funções foram removidas.';
END
$do$;

COMMIT;
