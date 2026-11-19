-- Rollback de 20280121020000_negocio_perdido_vai_para_etapa_perdida.sql
-- Cards já movidos continuam onde estão; só o comportamento futuro some.
DROP TRIGGER IF EXISTS trg_negocio_perdido_vai_para_etapa_perdida ON public.deals;
DROP FUNCTION IF EXISTS public.fn_negocio_perdido_vai_para_etapa_perdida();
