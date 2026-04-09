-- Per-organization API keys for external integrations
-- Keys are stored as SHA-256 hashes; the raw key is returned only once at creation time.

-- Ensure pgcrypto is available (for digest() in the RPC)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────
-- Table
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,                -- SHA-256 hash of the raw key
  key_prefix TEXT NOT NULL,              -- First 12 chars: "tq_live_xxxx"
  scopes TEXT[] NOT NULL DEFAULT '{lead:write,webhook:read}',
  rate_limit_per_minute INT NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

-- ─────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────
CREATE INDEX idx_api_keys_prefix ON public.api_keys(key_prefix);
CREATE INDEX idx_api_keys_org_active ON public.api_keys(organization_id, is_active);

-- ─────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- Any org member can view their org's keys (metadata only — hash is useless without raw key)
CREATE POLICY "Org members can view own org api_keys"
  ON public.api_keys FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  ));

-- Only admins or master user can create keys
CREATE POLICY "Admins can insert api_keys"
  ON public.api_keys FOR INSERT
  WITH CHECK (
    public.is_master_user()
    OR organization_id IN (
      SELECT organization_id FROM public.team_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Only admins or master user can update keys (revoke, toggle active, etc.)
CREATE POLICY "Admins can update api_keys"
  ON public.api_keys FOR UPDATE
  USING (
    public.is_master_user()
    OR organization_id IN (
      SELECT organization_id FROM public.team_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Only admins or master user can delete keys
CREATE POLICY "Admins can delete api_keys"
  ON public.api_keys FOR DELETE
  USING (
    public.is_master_user()
    OR organization_id IN (
      SELECT organization_id FROM public.team_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Service role bypasses RLS (Edge Functions, cron, etc.)
CREATE POLICY "service_role_api_keys_all"
  ON public.api_keys FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ─────────────────────────────────────────────
-- RPC: generate_api_key
-- Returns the raw key exactly once. After this, only the hash exists.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_api_key(
  p_org_id UUID,
  p_name TEXT,
  p_created_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw_key TEXT;
  v_key_hash TEXT;
  v_key_prefix TEXT;
  v_id UUID;
BEGIN
  -- Generate raw key: tq_live_ + 32 hex chars (16 random bytes)
  v_raw_key := 'tq_live_' || encode(gen_random_bytes(16), 'hex');

  -- SHA-256 hash for storage
  v_key_hash := encode(digest(v_raw_key, 'sha256'), 'hex');

  -- Prefix for fast lookup (first 12 chars: "tq_live_xxxx")
  v_key_prefix := left(v_raw_key, 12);

  -- Insert the key record
  INSERT INTO public.api_keys (organization_id, name, key_hash, key_prefix, created_by)
  VALUES (p_org_id, p_name, v_key_hash, v_key_prefix, p_created_by)
  RETURNING id INTO v_id;

  -- Return the raw key (shown once only) plus metadata
  RETURN jsonb_build_object(
    'key_id', v_id,
    'raw_key', v_raw_key,
    'prefix', v_key_prefix
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_api_key(UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_api_key(UUID, TEXT, UUID) TO service_role;
