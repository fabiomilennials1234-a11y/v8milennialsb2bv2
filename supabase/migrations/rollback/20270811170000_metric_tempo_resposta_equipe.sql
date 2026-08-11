-- ROLLBACK de 20270811170000_metric_tempo_resposta_equipe.sql
--
-- Só o catálogo sai. O ramo no despachante fica: sem a medida registrada,
-- `_metric_leaf` levanta 22023 antes de chegar no CASE. O leaf também fica —
-- derrubá-lo sem derrubar o ramo deixaria o despachante apontando para o vazio.

DELETE FROM public.metric_catalog_measure_formats  WHERE measure_id = 'tempo_resposta_equipe';
DELETE FROM public.metric_catalog_measure_recortes WHERE measure_id = 'tempo_resposta_equipe';
DELETE FROM public.metric_catalog_measures         WHERE id = 'tempo_resposta_equipe';
