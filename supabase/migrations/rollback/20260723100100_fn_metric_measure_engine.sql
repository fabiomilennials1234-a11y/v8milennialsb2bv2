-- ROLLBACK de 20260723100100_fn_metric_measure_engine.sql (#1194)
-- Ordem de reversão: 4ª (depois do snapshot e da composição, que o chamam;
-- antes do catálogo, que ele lê). Só funções → rollback = DROP FUNCTION.
-- Wrapper antes dos leaves/dispatcher (o wrapper depende deles, não o contrário,
-- mas DROP é seguro em qualquer ordem com IF EXISTS).

DROP FUNCTION IF EXISTS public.fn_metric_measure(uuid, jsonb, text, text, date, date, date, jsonb);
DROP FUNCTION IF EXISTS public._metric_leaf(uuid, text, text, text, date, date, date, jsonb);
DROP FUNCTION IF EXISTS public._metric_leaf_sales(uuid, text, text, tstzrange, text, jsonb);
DROP FUNCTION IF EXISTS public._metric_leaf_leads_criados(uuid, text, tstzrange, text, jsonb);
DROP FUNCTION IF EXISTS public._metric_leaf_meetings(uuid, text, text, tstzrange, text, jsonb);
DROP FUNCTION IF EXISTS public._metric_leaf_stage_snapshot(uuid, text, jsonb);
DROP FUNCTION IF EXISTS public._metric_leaf_stage_duration(uuid, text, jsonb);
