-- ROLLBACK de 20260723100200_composable_dashboard_schema.sql (#1194)
-- Ordem de reversão: 3ª (depois do snapshot que a lê; antes do motor e do
-- catálogo a que faz FK).
--
-- ATENÇÃO: DROP TABLE das tabelas de composição APAGA a config de dashboard das
-- orgs. Como a fatia é v1-flagada (nada em produção real até a flag ligar), o
-- estado esperado é vazio. Ainda assim o DROP é destrutivo — reverter só com
-- ciência de que qualquer página/widget montado se perde.
--
-- NÃO derruba public.set_updated_at(): é função utilitária compartilhada,
-- possivelmente usada por outras tabelas. Só os gatilhos que a referenciam caem
-- junto com as tabelas.

DROP FUNCTION IF EXISTS public.fn_publish_dashboard_page(uuid, uuid);

-- Tabelas (widgets antes de pages — FK page_id). CASCADE leva triggers e policies.
DROP TABLE IF EXISTS public.dashboard_widgets CASCADE;
DROP TABLE IF EXISTS public.dashboard_pages   CASCADE;

DROP FUNCTION IF EXISTS public.validate_widget_against_catalog();
