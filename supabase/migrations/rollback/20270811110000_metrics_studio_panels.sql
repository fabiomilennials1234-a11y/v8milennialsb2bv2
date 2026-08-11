-- ROLLBACK de 20270811110000_metrics_studio_panels.sql
--
-- ⚠ DESTRUTIVO: apaga o painel montado por cada usuário. Não há origem
-- alternativa — o localStorage foi abandonado quando a tabela entrou, e quem
-- salvou depois disso só tem esta linha.
--
-- Antes de rodar, se o objetivo for reverter código e não descartar dado:
--
--   CREATE TABLE public.metrics_studio_panels_backup AS
--     SELECT * FROM public.metrics_studio_panels;
--
-- O trigger e as policies caem junto com a tabela; não precisam de DROP
-- próprio.

DROP TABLE IF EXISTS public.metrics_studio_panels;
