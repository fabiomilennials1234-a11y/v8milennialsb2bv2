-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260715162952  name: omie_foundation
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- Omie ERP — connection lifecycle + deny-all credential vault (ADR-0020, slice S3).
CREATE TABLE public.omie_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'expired', 'disconnected')),
  erp_sync_mode TEXT NOT NULL DEFAULT 'enrich_only'
    CHECK (erp_sync_mode IN ('off', 'enrich_only', 'canonical')),
  omie_account_name TEXT,
  clientes_cursor INTEGER,
  pedidos_cursor INTEGER,
  financeiro_cursor INTEGER,
  last_clientes_sync_at TIMESTAMPTZ,
  last_pedidos_sync_at TIMESTAMPTZ,
  last_financeiro_sync_at TIMESTAMPTZ,
  last_error TEXT,
  connected_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_omie_org UNIQUE (organization_id)
);

CREATE INDEX idx_omie_connections_organization_id
  ON public.omie_connections(organization_id);

ALTER TABLE public.omie_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "omie_connections_member_select" ON public.omie_connections
  FOR SELECT
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

CREATE POLICY "omie_connections_admin_all" ON public.omie_connections
  FOR ALL
  USING (organization_id IN (SELECT public.get_my_admin_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.get_my_admin_organization_ids()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.omie_connections TO authenticated;

CREATE TRIGGER trg_omie_connections_updated_at
  BEFORE UPDATE ON public.omie_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.omie_connection_secrets (
  connection_id UUID PRIMARY KEY
    REFERENCES public.omie_connections(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  app_key_ciphertext TEXT NOT NULL,
  app_key_nonce TEXT NOT NULL,
  app_secret_ciphertext TEXT NOT NULL,
  app_secret_nonce TEXT NOT NULL,
  encryption_key_id TEXT NOT NULL DEFAULT 'v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_omie_connection_secrets_org
  ON public.omie_connection_secrets(organization_id);

COMMENT ON TABLE public.omie_connection_secrets IS
  'Omie app_key/app_secret, AES-256-GCM encrypted. Accessible only via service_role. Isolated from omie_connections so no member SELECT can ever leak the secrets.';

ALTER TABLE public.omie_connection_secrets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access omie_connection_secrets"
  ON public.omie_connection_secrets
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON public.omie_connection_secrets FROM authenticated;
REVOKE ALL ON public.omie_connection_secrets FROM anon;
GRANT ALL ON public.omie_connection_secrets TO service_role;

CREATE TRIGGER trg_omie_connection_secrets_updated_at
  BEFORE UPDATE ON public.omie_connection_secrets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
