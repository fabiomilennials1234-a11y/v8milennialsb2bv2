-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260703200048  name: carteira_erp_pull_cursor
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

ALTER TABLE public.tinyerp_connections
  ADD COLUMN IF NOT EXISTS order_pull_cursor integer;

COMMENT ON COLUMN public.tinyerp_connections.order_pull_cursor IS 'Página atual do backfill de pedidos (tinyerp-pull-orders). 0 = concluído.';
