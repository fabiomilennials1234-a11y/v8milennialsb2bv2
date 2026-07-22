-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260715191416  name: omie_titulos_cursor
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

ALTER TABLE public.omie_connections ADD COLUMN IF NOT EXISTS titulos_cursor INTEGER;
