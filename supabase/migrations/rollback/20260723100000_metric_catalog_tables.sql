-- ROLLBACK de 20260723100000_metric_catalog_tables.sql (#1194)
-- Ordem de reversão: 5ª e ÚLTIMA (todo o resto faz FK para o catálogo ou o lê;
-- só cai depois que motor, composição e snapshot já caíram).
--
-- Aditiva → rollback = DROP. As tabelas de catálogo são read-only semeadas por
-- migration; nenhum dado de tenant vive nelas, o DROP não perde nada do cliente.
-- A flag composable_metrics_enabled cai por último (o helper depende dela).

-- Compatibilidade + presets antes das tabelas-âncora (FK).
DROP TABLE IF EXISTS public.metric_catalog_measure_recortes CASCADE;
DROP TABLE IF EXISTS public.metric_catalog_measure_formats   CASCADE;
DROP TABLE IF EXISTS public.metric_catalog_ratios            CASCADE;
DROP TABLE IF EXISTS public.metric_catalog_measures          CASCADE;
DROP TABLE IF EXISTS public.metric_catalog_recortes          CASCADE;
DROP TABLE IF EXISTS public.metric_catalog_formats           CASCADE;

DROP FUNCTION IF EXISTS public.fn_metric_catalog();

-- Flag de rollout + helper.
DROP FUNCTION IF EXISTS public.fn_composable_metrics_enabled(uuid);
ALTER TABLE public.organizations DROP COLUMN IF EXISTS composable_metrics_enabled;
