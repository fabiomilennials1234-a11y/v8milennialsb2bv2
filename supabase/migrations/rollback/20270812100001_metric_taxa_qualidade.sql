-- ROLLBACK de 20270812100001_metric_taxa_qualidade.sql
--
-- A fatia inteira é uma linha de catálogo — não há função para restaurar, nem
-- ramo de despachante para desfazer.
--
-- Efeito de tirar a linha: a razão some da descoberta (`fn_metric_catalog`) e da
-- lista do Estúdio. O par (boas_avaliacoes ÷ leads_avaliados) continua
-- CALCULÁVEL pelo motor — ele nunca consultou esta tabela —, então painel salvo
-- que já referencie o par segue funcionando. Isto é o desenho, não uma sobra.

DELETE FROM public.metric_catalog_ratios WHERE id = 'taxa_qualidade';
