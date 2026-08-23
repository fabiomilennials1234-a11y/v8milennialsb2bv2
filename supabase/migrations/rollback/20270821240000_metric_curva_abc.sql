-- ===========================================================================
-- ROLLBACK — 20270821240000_metric_curva_abc.sql (SCRUM-418)
-- ===========================================================================
-- Ordem: despachante PRIMEIRO (corpo de 20270821230000, sem o ramo), depois
-- DROP FUNCTION public._metric_leaf_curva_abc(uuid, text, tstzrange, text, jsonb),
-- depois as linhas de catálogo.
-- ===========================================================================
DO $$
BEGIN
  RAISE EXCEPTION 'Rollback manual: despachante de 20270821230000 → função → catálogo.';
END
$$;
