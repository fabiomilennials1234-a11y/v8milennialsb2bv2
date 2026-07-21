-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260715173600  name: omie_pedidos_external_ids
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

ALTER TABLE public.upsell_orders ADD COLUMN IF NOT EXISTS external_source TEXT;
ALTER TABLE public.upsell_orders ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE public.upsell_orders ADD COLUMN IF NOT EXISTS external_ref TEXT;

UPDATE public.upsell_orders
  SET external_source = 'tiny', external_id = tiny_order_id
  WHERE tiny_order_id IS NOT NULL AND external_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_upsell_orders_external
  ON public.upsell_orders (organization_id, external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;
