-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260703185737  name: carteira_erp_order_dedup
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

ALTER TABLE public.upsell_orders
  ADD COLUMN IF NOT EXISTS tiny_order_id text;

COMMENT ON COLUMN public.upsell_orders.tiny_order_id IS 'ID do pedido no TinyERP — dedup do pull ERP';

CREATE UNIQUE INDEX IF NOT EXISTS uq_upsell_orders_org_tiny_order
  ON public.upsell_orders(organization_id, tiny_order_id)
  WHERE tiny_order_id IS NOT NULL;
