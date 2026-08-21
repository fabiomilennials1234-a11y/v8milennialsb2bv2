-- ===========================================================================
-- ROLLBACK — 20270821220000_metric_taxa_resposta_automacao.sql (SCRUM-421)
-- ===========================================================================
-- Ordem: despachante PRIMEIRO (corpo de 20270821210000, sem os dois ramos),
-- depois DROP FUNCTION public._metric_leaf_automacao(uuid, text, tstzrange, text, jsonb, text),
-- depois as linhas de catálogo das DUAS medidas.
-- ===========================================================================
DO $$
BEGIN
  RAISE EXCEPTION 'Rollback manual: restaure o despachante de 20270821210000, depois a função, depois o catálogo das duas medidas.';
END
$$;
