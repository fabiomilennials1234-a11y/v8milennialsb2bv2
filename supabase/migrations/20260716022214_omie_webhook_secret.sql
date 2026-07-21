-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260716022214  name: omie_webhook_secret
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

ALTER TABLE public.omie_connection_secrets
  ADD COLUMN IF NOT EXISTS webhook_secret_hash TEXT;
