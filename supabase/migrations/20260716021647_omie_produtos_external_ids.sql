-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260716021647  name: omie_produtos_external_ids
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS external_source TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS external_ref TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_external
  ON public.products (organization_id, external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

ALTER TABLE public.omie_connections
  ADD COLUMN IF NOT EXISTS produtos_cursor INTEGER,
  ADD COLUMN IF NOT EXISTS last_produtos_sync_at TIMESTAMPTZ;
