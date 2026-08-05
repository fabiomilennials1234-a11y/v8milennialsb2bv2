-- 20270203000000_omie_foundation.sql
--
-- REPLAY-SAFE em 2026-07-30. As duas tabelas deste arquivo JÁ ESTÃO no
-- `20260101000000_baseline_prod_schema.sql` — o baseline é um dump do prod
-- tirado DEPOIS de o Omie ter sido aplicado lá. Com `CREATE TABLE` cru, o
-- replay do zero morria aqui ("relation omie_connections already exists"),
-- e junto com ele os três jobs de CI que dependem de `supabase start`:
-- RLS Invariants, Integration Tests e E2E Tests.
--
-- Nada muda em produção: lá isto já está aplicado, e todo statement agora é
-- idempotente. O que muda é que a árvore de migrations volta a poder ser
-- reproduzida do zero — que é a única forma de o CI testar schema.
-- Omie ERP — connection lifecycle + deny-all credential vault (ADR-0020, slice S3).
--
-- Two tables:
--   1. omie_connections        — 1 per org, member-readable, admin-managed. No secrets.
--   2. omie_connection_secrets — deny-all; only service_role (edge functions) touch it.
--
-- Secrets (app_key + app_secret) are AES-256-GCM encrypted in the edge function
-- (_shared/erp/crypto.ts) with env OMIE_ENCRYPTION_KEY; only ciphertext lands here.
-- RLS uses get_my_organization_ids() / get_my_admin_organization_ids() helpers,
-- never an inline team_members subquery (Realtime apply_rls() recursion rule).

-- ============================================================
-- 1. omie_connections (1 per org) — no secrets stored here
-- ============================================================
CREATE TABLE IF NOT EXISTS public.omie_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),

  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'expired', 'disconnected')),

  -- How aggressively the ERP reconciles client fields (ADR-0020).
  erp_sync_mode TEXT NOT NULL DEFAULT 'enrich_only'
    CHECK (erp_sync_mode IN ('off', 'enrich_only', 'canonical')),

  -- Display info captured at connect time.
  omie_account_name TEXT,

  -- Resumable cursors + last-sync markers, per entity family.
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

CREATE INDEX IF NOT EXISTS idx_omie_connections_organization_id
  ON public.omie_connections(organization_id);

ALTER TABLE public.omie_connections ENABLE ROW LEVEL SECURITY;

-- Members of the org may read the connection (status + sync mode drive the UI).
DROP POLICY IF EXISTS "omie_connections_member_select" ON public.omie_connections;
CREATE POLICY "omie_connections_member_select" ON public.omie_connections
  FOR SELECT
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

-- Only org admins manage the connection (connect/disconnect also runs via
-- service_role edge functions, which bypass RLS).
DROP POLICY IF EXISTS "omie_connections_admin_all" ON public.omie_connections;
CREATE POLICY "omie_connections_admin_all" ON public.omie_connections
  FOR ALL
  USING (organization_id IN (SELECT public.get_my_admin_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.get_my_admin_organization_ids()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.omie_connections TO authenticated;

DROP TRIGGER IF EXISTS trg_omie_connections_updated_at ON public.omie_connections;
CREATE TRIGGER trg_omie_connections_updated_at
  BEFORE UPDATE ON public.omie_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 2. omie_connection_secrets — DENY-ALL, service_role only
--    RLS enabled + no authenticated/anon policy = deny by default.
--    Mirrors whatsapp_instance_secrets (stricter than the tinyerp_connections
--    pattern, whose encrypted columns are member-readable).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.omie_connection_secrets (
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

CREATE INDEX IF NOT EXISTS idx_omie_connection_secrets_org
  ON public.omie_connection_secrets(organization_id);

COMMENT ON TABLE public.omie_connection_secrets IS
  'Omie app_key/app_secret, AES-256-GCM encrypted. Accessible only via service_role. '
  'Isolated from omie_connections so no member SELECT can ever leak the secrets.';

ALTER TABLE public.omie_connection_secrets ENABLE ROW LEVEL SECURITY;

-- Single policy: service_role only. No policy for authenticated/anon = deny all.
DROP POLICY IF EXISTS "Service role full access omie_connection_secrets"
  ON public.omie_connection_secrets;
CREATE POLICY "Service role full access omie_connection_secrets"
  ON public.omie_connection_secrets
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Defense in depth: explicit REVOKE (Supabase managed keeps table-level GRANTs).
REVOKE ALL ON public.omie_connection_secrets FROM authenticated;
REVOKE ALL ON public.omie_connection_secrets FROM anon;
GRANT ALL ON public.omie_connection_secrets TO service_role;

DROP TRIGGER IF EXISTS trg_omie_connection_secrets_updated_at ON public.omie_connection_secrets;
CREATE TRIGGER trg_omie_connection_secrets_updated_at
  BEFORE UPDATE ON public.omie_connection_secrets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
