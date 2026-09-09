-- Rollback de 20270916000020_a_trava_enxerga_a_lista.sql
--
-- ⚠️ NÃO ROLE ISTO SEM ROLAR TAMBÉM O ROLLBACK DA 20270916000010.
--
-- Voltar a trava para SECURITY INVOKER a devolve ao estado cego: sob uma
-- sessão comum ela não enxerga `rollout_exige_valor_venda` (RLS: só master) e
-- passa a recusar a venda nas 19 orgs deliberadamente poupadas. Medido em
-- prod: 19 orgs visíveis como superuser, 0 como authenticated.
--
-- Não existe motivo para querer esse estado. Se a trava precisa sair, sai
-- inteira — pelo rollback da 20270916000010, que derruba trigger e função.
--
-- Este arquivo existe para o caso de a fatia inteira ser revertida em ordem,
-- e falha de propósito se for rodado sozinho.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = 'deals' AND t.tgname = 'a_trg_exige_valor_no_negocio'
       AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'a trava ainda esta ativa — reverter so o DEFINER a deixaria cega e recusaria as 19 orgs poupadas. Rode antes o rollback da 20270916000010.';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.fn_exige_valor_no_negocio();
