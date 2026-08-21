-- ===========================================================================
-- ROLLBACK — 20270821200000_metric_ltv.sql (SCRUM-417)
-- ===========================================================================
-- Ordem: despachante PRIMEIRO (para de apontar), depois a função, depois o
-- catálogo. Inverter deixaria o despachante chamando função inexistente entre
-- dois statements.
--
-- O corpo do despachante a restaurar é o de `20270821190000_metric_taxa_pre_venda.sql`
-- (21 ramos, sem `ltv`). Copiar de lá, não reescrever de memória.
-- ===========================================================================

DO $$
BEGIN
  RAISE EXCEPTION
    'Rollback manual: restaure o despachante de 20270821190000, depois DROP FUNCTION public._metric_leaf_ltv(uuid, text, tstzrange, text, jsonb), depois apague as linhas de catálogo de ltv.';
END
$$;
