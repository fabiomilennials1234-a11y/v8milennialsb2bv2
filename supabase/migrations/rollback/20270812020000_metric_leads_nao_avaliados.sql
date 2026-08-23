-- ROLLBACK de 20270812020000_metric_leads_nao_avaliados.sql
--
-- Tira a medida do catálogo. O RAMO no despachante fica — ramo sem medida
-- catalogada é inerte: `_metric_leaf` recusa antes de chegar no CASE, porque a
-- primeira coisa que ele faz é procurar a medida em metric_catalog_measures e
-- levantar 22023 se não achar.
--
-- Reescrever o despachante aqui seria pior: ele muda a cada fatia da série, e
-- um rollback que o congela numa versão antiga apagaria o ramo de quem veio
-- depois.

DELETE FROM public.metric_catalog_measure_formats  WHERE measure_id = 'leads_nao_avaliados';
DELETE FROM public.metric_catalog_measure_recortes WHERE measure_id = 'leads_nao_avaliados';
DELETE FROM public.metric_catalog_measures         WHERE id = 'leads_nao_avaliados';
