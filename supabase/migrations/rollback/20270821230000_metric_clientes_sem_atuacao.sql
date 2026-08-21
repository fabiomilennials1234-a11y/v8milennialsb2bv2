-- ===========================================================================
-- ROLLBACK — 20270821230000_metric_clientes_sem_atuacao.sql (SCRUM-420)
-- ===========================================================================
-- Ordem: despachante PRIMEIRO (corpo de 20270821220000, sem o ramo), depois
-- DROP FUNCTION public._metric_leaf_clientes_sem_atuacao(uuid, text, jsonb),
-- depois DROP FUNCTION public._metric_ultimo_toque(uuid, uuid, timestamptz),
-- depois as linhas de catálogo.
--
-- A ordem entre as duas funções importa: a do leaf CHAMA a do último toque.
-- ===========================================================================
DO $$
BEGIN
  RAISE EXCEPTION 'Rollback manual: despachante de 20270821220000 → leaf → _metric_ultimo_toque → catálogo.';
END
$$;
