-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260715171055  name: omie_clientes_external_ids
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

ALTER TABLE public.upsell_clients ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE public.upsell_clients ADD COLUMN IF NOT EXISTS external_ref TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_upsell_clients_external
  ON public.upsell_clients (organization_id, external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;
