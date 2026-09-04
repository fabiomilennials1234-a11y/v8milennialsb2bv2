-- Rollback de 20270916000010_trava_de_valor_pergunta_ao_negocio.sql
--
-- Derruba a trava de valor no negócio. A trava da etapa
-- (`trg_exige_valor_na_venda`, de 20270909000010) NÃO é tocada — ela continua
-- de pé e volta a ser a única defesa, exatamente como antes desta migration.
--
-- ⚠️ O que NÃO volta: o backfill dos 2 negócios cujo valor foi copiado da
-- entrada para `deals.value`. Reverter significaria apagar um número correto
-- para reinstalar um branco — e o valor segue existindo na entrada ao lado,
-- de onde veio. A receita do caderno nunca dependeu dessa cópia
-- (`COALESCE(d.value, metadata)`), então desfazer não devolveria nada a
-- lugar nenhum. Deixar é a opção conservadora.
--
-- ⚠️ Também não volta o valor que a trava recuperou de entradas durante o
-- tempo em que esteve no ar, pelo mesmo motivo.

DROP TRIGGER IF EXISTS a_trg_exige_valor_no_negocio ON public.deals;
DROP FUNCTION IF EXISTS public.fn_exige_valor_no_negocio();

DO $$
DECLARE v_trg integer; v_etapa integer;
BEGIN
  SELECT count(*) INTO v_trg FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relname = 'deals' AND t.tgname = 'a_trg_exige_valor_no_negocio'
     AND NOT t.tgisinternal;
  IF v_trg <> 0 THEN
    RAISE EXCEPTION 'a trava do negocio continua de pe';
  END IF;

  -- Sair daqui sem NENHUMA trava reabriria o vazamento de 44% em silêncio.
  SELECT count(*) INTO v_etapa FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relname = 'pipeline_entries' AND t.tgname = 'trg_exige_valor_na_venda'
     AND NOT t.tgisinternal;
  IF v_etapa <> 1 THEN
    RAISE EXCEPTION 'a trava da etapa nao esta de pe — rollback deixaria a venda sem valor passar por qualquer caminho';
  END IF;
END $$;
