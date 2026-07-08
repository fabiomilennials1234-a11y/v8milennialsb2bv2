-- ROLLBACK de 20270302000100_sale_events_state_backfill.sql (U2)
--
-- Remove as duas funções do backfill governado de venda por estado. NÃO
-- desfaz as linhas sale_events já emitidas (source='backfill'): o caderno é
-- append-only e imutável (ADR-0017 §3) — corrigir uma venda backfillada é
-- evento novo (estorno), nunca DELETE. Reverter as linhas exigiria a operação
-- de teardown de entidade-mãe (delete de lead/org), fora do escopo deste DROP.
--
-- Só as funções caem. O efeito de dados (as vendas contadas) permanece, de
-- propósito: o backfill é o próprio fato histórico honesto que quisemos gravar.

BEGIN;

DROP FUNCTION IF EXISTS public.fn_backfill_state_sales();
DROP FUNCTION IF EXISTS public.fn_backfill_parse_sale_value(text);

COMMIT;
