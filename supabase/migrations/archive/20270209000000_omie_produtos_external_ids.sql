-- 20270209000000_omie_produtos_external_ids.sql
-- S12 (#1112): identidade externa genérica em products + cursor de produtos.
-- Espelha a migration de clientes. Aditivo.

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS external_source TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS external_ref TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_external
  ON public.products (organization_id, external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

ALTER TABLE public.omie_connections
  ADD COLUMN IF NOT EXISTS produtos_cursor INTEGER,
  ADD COLUMN IF NOT EXISTS last_produtos_sync_at TIMESTAMPTZ;
