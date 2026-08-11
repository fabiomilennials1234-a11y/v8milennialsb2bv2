-- ROLLBACK de 20270811150000_metric_boas_avaliacoes.sql
--
-- Mesma razão da fatia anterior: só o catálogo sai. Ramo órfão no despachante é
-- inerte, porque `_metric_leaf` valida a medida contra o catálogo antes do CASE.

DELETE FROM public.metric_catalog_measure_formats  WHERE measure_id = 'boas_avaliacoes';
DELETE FROM public.metric_catalog_measure_recortes WHERE measure_id = 'boas_avaliacoes';
DELETE FROM public.metric_catalog_measures         WHERE id = 'boas_avaliacoes';
