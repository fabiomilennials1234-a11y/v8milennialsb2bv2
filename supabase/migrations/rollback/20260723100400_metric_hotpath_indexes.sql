-- ROLLBACK de 20260723100400_metric_hotpath_indexes.sql (#1194)
-- Ordem de reversão: 1ª a reverter (índices são folha, ninguém depende deles).
-- Puramente aditiva → rollback = DROP INDEX. Sem perda de dado.

DROP INDEX IF EXISTS public.idx_pse_org_lead_pipe_occurred;
DROP INDEX IF EXISTS public.idx_pipeline_entries_open_snapshot;
DROP INDEX IF EXISTS public.idx_leads_org_metric_period;
DROP INDEX IF EXISTS public.idx_sale_events_org_closer_sold;
DROP INDEX IF EXISTS public.idx_lead_tags_tag_lead;
DROP INDEX IF EXISTS public.idx_lead_products_product_lead;
