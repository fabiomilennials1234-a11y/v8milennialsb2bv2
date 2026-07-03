-- carteira Camada 2 — dedup de pedido ERP em upsell_orders
--
-- tiny_order_id = id do pedido no TinyERP. Índice único parcial por org garante
-- idempotência do pull (re-rodar não duplica). Antes o erp-order-webhook dedupava
-- por notes='tiny:<id>' (frágil); coluna dedicada é mais limpa.

ALTER TABLE public.upsell_orders
  ADD COLUMN IF NOT EXISTS tiny_order_id text;

COMMENT ON COLUMN public.upsell_orders.tiny_order_id IS 'ID do pedido no TinyERP — dedup do pull ERP';

CREATE UNIQUE INDEX IF NOT EXISTS uq_upsell_orders_org_tiny_order
  ON public.upsell_orders(organization_id, tiny_order_id)
  WHERE tiny_order_id IS NOT NULL;
