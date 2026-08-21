-- ===========================================================================
-- ROLLBACK — 20270821190000_metric_taxa_pre_venda.sql (SCRUM-422)
-- ===========================================================================
-- ⚠ ORDEM OBRIGATÓRIA, e ela não é a intuitiva.
--
-- Recriar a de SEIS argumentos ANTES de apagar a de sete deixa as duas vivas ao
-- mesmo tempo, e aí toda chamada com seis argumentos casa com as duas: o
-- Postgres recusa com "function is not unique" e o motor inteiro para. A janela
-- entre um statement e outro é curta, mas o apply não é atômico do ponto de
-- vista de quem estiver consultando.
--
-- Sequência correta:
--   1. despachante volta ao corpo de 20270821170000 (chama a de 6 argumentos);
--   2. apaga a de SETE;
--   3. recria a de SEIS, com o corpo de 20260723100100;
--   4. catálogo.
--
-- O corpo da de seis argumentos está em `20260723100100_fn_metric_measure_engine.sql`
-- e o do despachante em `20270821170000_metric_ganho_perda.sql`. Copiar de lá,
-- não reescrever de memória — foi reescrever de memória que apagou o roteamento
-- de 6 medidas na 20260727140000.
-- ===========================================================================

DO $$
BEGIN
  RAISE EXCEPTION
    'Rollback manual: a ordem importa (despachante → drop da de 7 → recria a de 6 → catálogo). Veja o cabeçalho.';
END
$$;
