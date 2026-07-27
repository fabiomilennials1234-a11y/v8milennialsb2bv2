-- 20270204000000_omie_clientes_external_ids.sql
-- S4 (#1104): identidade externa genérica em upsell_clients para a camada multi-ERP.
-- external_source já existe. Adiciona external_id (id imutável do ERP, ex. codigo_cliente_omie)
-- e external_ref (uuid-ponte, ex. codigo_cliente_integracao). Idempotência do sync via
-- índice único parcial (org, source, id). Aditivo — sem impacto em dados existentes.

ALTER TABLE public.upsell_clients ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE public.upsell_clients ADD COLUMN IF NOT EXISTS external_ref TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_upsell_clients_external
  ON public.upsell_clients (organization_id, external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;
