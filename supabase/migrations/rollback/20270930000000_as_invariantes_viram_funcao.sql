-- ROLLBACK de 20270930000000_as_invariantes_viram_funcao.sql
--
-- A migration é ADITIVA: cria 4 funções e não troca chamador nenhum. O rollback
-- é o DROP delas, e é seguro ENQUANTO o passo 2 (INSTEAD OF delegam) e o passo 3
-- (as 5 escritoras delegam) não tiverem sido aplicados.
--
-- ⚠️ DEPOIS DO PASSO 2 OU 3, ESTE ARQUIVO NÃO SERVE SOZINHO: os INSTEAD OF e as
-- RPCs passariam a chamar função inexistente e toda escrita de funil quebraria.
-- Nessa altura, reverter exige rodar ANTES o rollback do passo correspondente.

BEGIN;

DROP FUNCTION IF EXISTS public.fn_entrada_sistema_criar(uuid, text, uuid, text, uuid, uuid, uuid, jsonb, text, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.fn_entrada_sistema_atualizar(uuid, jsonb);
DROP FUNCTION IF EXISTS public.fn_entrada_custom_criar(uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.fn_entrada_custom_atualizar(uuid, jsonb);

-- Guarda: se alguma delas ainda for citada por outra função, o DROP acima
-- passou mas o banco fica quebrado no próximo INSERT. Aborta em vez de deixar.
DO $$
DECLARE v_refs text;
BEGIN
  SELECT string_agg(p.proname, ', ')
    INTO v_refs
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosrc ~* 'fn_entrada_(sistema|custom)_(criar|atualizar)';
  IF v_refs IS NOT NULL THEN
    RAISE EXCEPTION 'rollback abortado: ainda há chamadores das funções removidas (%). Rode antes o rollback do passo 2/3.', v_refs;
  END IF;
END $$;

COMMIT;
