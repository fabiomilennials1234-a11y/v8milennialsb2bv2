-- ROLLBACK de 20270811160000_metric_negocios_perdidos.sql
--
-- Só o catálogo sai. O ramo no despachante fica: ramo sem medida catalogada é
-- inerte, porque `_metric_leaf` procura a medida em metric_catalog_measures e
-- levanta 22023 antes de chegar no CASE. Reescrever o despachante aqui apagaria
-- os ramos de quem veio depois nesta série.
--
-- O leaf também fica. Ele não é chamado por mais ninguém, e derrubá-lo sem
-- derrubar o ramo deixaria o despachante apontando para o vazio.

DELETE FROM public.metric_catalog_measure_formats  WHERE measure_id = 'negocios_perdidos';
DELETE FROM public.metric_catalog_measure_recortes WHERE measure_id = 'negocios_perdidos';
DELETE FROM public.metric_catalog_measures         WHERE id = 'negocios_perdidos';
