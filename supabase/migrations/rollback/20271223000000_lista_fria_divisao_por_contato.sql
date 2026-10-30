-- ROLLBACK de 20271223000000_lista_fria_divisao_por_contato.sql
-- Só remove as duas RPCs; nada de dado muda (a seleção que elas fizeram é só a coluna `selecionado`).

BEGIN;

DROP FUNCTION public.lista_fria_resultados_selecionar_por_contato(uuid, boolean, boolean, boolean);
DROP FUNCTION public.lista_fria_resultados_divisao(uuid, boolean, boolean, boolean);

COMMIT;
