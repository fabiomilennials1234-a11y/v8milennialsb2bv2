-- carteira Camada 2 — schema base pro sync ERP (TinyERP) → carteira
--
-- Adiciona chaves de matching + proveniência em upsell_clients e tracking/modo
-- em tinyerp_connections. Aditivo e seguro (sem backfill destrutivo).
--
-- contact_sync_mode governa auto-criação de cliente a partir do Tiny:
--   off          — não sincroniza contatos
--   enrich_only  — só casa+enriquece clientes já existentes; loga não-casados (DEFAULT seguro)
--   canonical    — cria os contatos Tiny que não têm par na carteira

-- ── upsell_clients: matching + proveniência ──────────────────────────────────
ALTER TABLE public.upsell_clients
  ADD COLUMN IF NOT EXISTS cnpj            text,
  ADD COLUMN IF NOT EXISTS tiny_contact_id text,
  ADD COLUMN IF NOT EXISTS external_source text,
  ADD COLUMN IF NOT EXISTS tiny_synced_at  timestamptz;

COMMENT ON COLUMN public.upsell_clients.cnpj IS 'CNPJ/CPF só dígitos — chave de matching com contato ERP';
COMMENT ON COLUMN public.upsell_clients.tiny_contact_id IS 'ID do contato no TinyERP — upsert idempotente';
COMMENT ON COLUMN public.upsell_clients.external_source IS 'Proveniência: tiny | import | manual';

-- 1 cliente por contato Tiny dentro da org (upsert idempotente)
CREATE UNIQUE INDEX IF NOT EXISTS uq_upsell_clients_org_tiny_contact
  ON public.upsell_clients(organization_id, tiny_contact_id)
  WHERE tiny_contact_id IS NOT NULL;

-- match por CNPJ (não único: dup histórica possível — worker resolve pro mais recente)
CREATE INDEX IF NOT EXISTS idx_upsell_clients_org_cnpj
  ON public.upsell_clients(organization_id, cnpj)
  WHERE cnpj IS NOT NULL;

-- ── tinyerp_connections: tracking + modo ─────────────────────────────────────
ALTER TABLE public.tinyerp_connections
  ADD COLUMN IF NOT EXISTS last_contact_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_order_pull_at   timestamptz,
  ADD COLUMN IF NOT EXISTS contact_sync_mode    text NOT NULL DEFAULT 'enrich_only';

ALTER TABLE public.tinyerp_connections
  DROP CONSTRAINT IF EXISTS tinyerp_connections_contact_sync_mode_check;
ALTER TABLE public.tinyerp_connections
  ADD CONSTRAINT tinyerp_connections_contact_sync_mode_check
  CHECK (contact_sync_mode IN ('off', 'enrich_only', 'canonical'));
