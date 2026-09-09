-- Reversão antes da abertura ao usuário. Nunca apaga vendas já registradas.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.historical_sale_batches)
     OR EXISTS (SELECT 1 FROM public.upsell_orders WHERE source='historical') THEN
    RAISE EXCEPTION 'Há vendas históricas: preserve os dados e desabilite apenas a execução da RPC.';
  END IF;
END $$;
DROP FUNCTION public.registrar_vendas_historicas(uuid, uuid, jsonb);
DROP TRIGGER guard_historical_order_edit ON public.upsell_orders;
DROP FUNCTION public.guard_historical_order_edit();
DROP INDEX public.deals_historical_sales_by_lead;
DROP TABLE public.historical_sale_batches;
ALTER TABLE public.upsell_orders DROP CONSTRAINT upsell_orders_source_check;
ALTER TABLE public.upsell_orders ADD CONSTRAINT upsell_orders_source_check
  CHECK (source IN ('pipe', 'manual', 'erp', 'copilot', 'csv_import'));
COMMIT;
