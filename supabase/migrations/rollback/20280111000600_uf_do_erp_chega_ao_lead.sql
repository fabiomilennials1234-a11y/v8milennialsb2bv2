-- Rollback de 20280111000600_uf_do_erp_chega_ao_lead.sql
--
-- Tira o trigger e as duas funções. As UFs que ele já gravou nos leads
-- (uf_source = 'erp') continuam: são informação do ERP, e trg_leads_derive_uf
-- não as troca de volta pelo DDD.

DROP TRIGGER IF EXISTS trg_upsell_clients_uf_para_lead ON public.upsell_clients;
DROP FUNCTION IF EXISTS public.upsell_clients_uf_para_lead();
DROP FUNCTION IF EXISTS public.uf_brasileira(text);
