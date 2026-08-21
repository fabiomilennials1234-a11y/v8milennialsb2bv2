-- ===========================================================================
-- ROLLBACK — 20270821210000_metric_clientes_sem_resposta.sql (SCRUM-419)
-- ===========================================================================
-- Ordem: despachante PRIMEIRO (corpo de 20270821200000, sem o ramo), depois
-- DROP FUNCTION public._metric_leaf_clientes_sem_resposta(uuid, text, jsonb),
-- depois as linhas de catálogo.
-- ===========================================================================
DO $$
BEGIN
  RAISE EXCEPTION 'Rollback manual: restaure o despachante de 20270821200000, depois a função, depois o catálogo.';
END
$$;
