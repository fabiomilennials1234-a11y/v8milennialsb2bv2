-- 20270101000000_crm_mcp_personal_access_tokens.sql
--
-- crm-mcp C2 — Personal Access Token (PAT) infrastructure for the customer-facing MCP.
-- Spec: .specs/features/crm-mcp/DESIGN.md §7. RLS-pure per-user: a PAT maps to exactly
-- one (user_id, organization_id); the edge function inherits that user's RLS visibility,
-- never master, never service_role.
--
-- This migration ships:
--   1. public.personal_access_tokens         — the token store (hash-only, display-once)
--   2. an immutability trigger                — hash/scopes/owner/org/audience are frozen
--   3. RLS                                    — a user manages only their own tokens;
--                                               org admins govern their org; master-ghost
--   4. public.crm_mcp_resolve_token(p_hash)   — the single, hermetic, pre-auth resolver

-- ============================================================================
-- 1. Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.personal_access_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  -- SHA-256 (or HMAC-SHA256 with pepper) hex of the FULL token. Unique → point lookup.
  -- No salt: the token is already globally unique and high-entropy (DESIGN §4.2).
  token_hash      char(64) NOT NULL,
  token_prefix    text NOT NULL,                          -- non-secret display fragment
  audience        text NOT NULL DEFAULT 'crm-mcp',        -- static resource binding (RFC 8707-ish)
  scopes          text[] NOT NULL DEFAULT array['read'],  -- intersect with RLS, never additive
  last_used_at    timestamptz,
  expires_at      timestamptz NOT NULL,                   -- mandatory; app caps at created_at+366d
  revoked_at      timestamptz,                            -- soft-delete; keep row for audit
  revoked_reason  text,                                   -- user|expired|auto_unused|compromise|master_principal|offboarding
  created_by      uuid REFERENCES auth.users(id),         -- = user_id for a PAT; differs for a future svc token
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pat_token_hash_uq ON public.personal_access_tokens (token_hash);
CREATE INDEX IF NOT EXISTS pat_active_lookup ON public.personal_access_tokens (token_hash)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS pat_user_idx ON public.personal_access_tokens (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pat_org_idx ON public.personal_access_tokens (organization_id);

-- ============================================================================
-- 2. Immutability — token_hash / scopes / owner / org / audience are frozen after insert.
--    Only revoked_at/revoked_reason/last_used_at may change (DESIGN §7.1, H4).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.pat_block_immutable_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  IF new.token_hash <> old.token_hash
     OR new.scopes IS DISTINCT FROM old.scopes
     OR new.organization_id <> old.organization_id
     OR new.user_id <> old.user_id
     OR new.audience IS DISTINCT FROM old.audience THEN
    RAISE EXCEPTION 'personal_access_tokens: token_hash/scopes/owner/audience are immutable';
  END IF;
  RETURN new;
END
$$;

DROP TRIGGER IF EXISTS pat_immutable ON public.personal_access_tokens;
CREATE TRIGGER pat_immutable
  BEFORE UPDATE ON public.personal_access_tokens
  FOR EACH ROW EXECUTE FUNCTION public.pat_block_immutable_update();

-- ============================================================================
-- 3. RLS — governs the MANAGEMENT UI (the hot-path resolve uses the RPC below, not these).
--    Uses the SECURITY DEFINER helpers per CLAUDE.md (never inline team_members subqueries).
-- ============================================================================
ALTER TABLE public.personal_access_tokens ENABLE ROW LEVEL SECURITY;

-- A user sees and manages only their own tokens.
DROP POLICY IF EXISTS pat_owner_select ON public.personal_access_tokens;
CREATE POLICY pat_owner_select ON public.personal_access_tokens
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS pat_owner_insert ON public.personal_access_tokens;
CREATE POLICY pat_owner_insert ON public.personal_access_tokens
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND organization_id IN (SELECT public.get_my_organization_ids())
  );

-- Revoke-only update (the trigger blocks mutating the frozen columns).
DROP POLICY IF EXISTS pat_owner_update ON public.personal_access_tokens;
CREATE POLICY pat_owner_update ON public.personal_access_tokens
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Org admin governs every token in their org.
DROP POLICY IF EXISTS pat_admin_manage ON public.personal_access_tokens;
CREATE POLICY pat_admin_manage ON public.personal_access_tokens
  FOR ALL USING (organization_id IN (SELECT public.get_my_admin_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.get_my_admin_organization_ids()));

-- Master-ghost from day 1 (the class that has bitten Torque 5+ times) — for the GESTÃO UI.
DROP POLICY IF EXISTS pat_master_ghost ON public.personal_access_tokens;
CREATE POLICY pat_master_ghost ON public.personal_access_tokens
  FOR ALL USING (public.is_master_user()) WITH CHECK (public.is_master_user());

GRANT SELECT, INSERT, UPDATE ON public.personal_access_tokens TO authenticated;

-- ============================================================================
-- 4. crm_mcp_resolve_token — the ONLY pre-auth resolver. Hermetic by construction.
--
--    Called BEFORE any user session exists, via the function's anon-key client (role
--    `anon`). DESIGN §7.6 noted a tension (revoke-from-anon vs anon being the only pre-auth
--    role); resolved here in favor of "anon-callable but hermetic":
--      - returns ONLY identity columns for an EXACT token_hash match — never SELECT *;
--      - returns NO row on a miss, and does NOT distinguish not-found from revoked, so it is
--        not an existence oracle (and a 178-bit token is unguessable anyway);
--      - folds is_master(user_id) + the user's CURRENT active org_ids into the same call so
--        the edge function decides eligibility in pure TS (master-reject H1, org-drift M5)
--        in a single round-trip, without granting the resolver role anything else.
--    The hermetic contract is the wall; possessing the token is the only way to resolve it.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.crm_mcp_resolve_token(p_hash char(64))
RETURNS TABLE (
  id              uuid,
  user_id         uuid,
  organization_id uuid,
  scopes          text[],
  expires_at      timestamptz,
  revoked_at      timestamptz,
  audience        text,
  is_master       boolean,
  current_org_ids uuid[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    t.id,
    t.user_id,
    t.organization_id,
    t.scopes,
    t.expires_at,
    t.revoked_at,
    t.audience,
    public.is_master_user(t.user_id) AS is_master,
    COALESCE(
      (SELECT array_agg(tm.organization_id)
         FROM public.team_members tm
        WHERE tm.user_id = t.user_id AND tm.is_active = true),
      '{}'::uuid[]
    ) AS current_org_ids
  FROM public.personal_access_tokens t
  WHERE t.token_hash = p_hash
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.crm_mcp_resolve_token(char) IS
  'crm-mcp pre-auth PAT resolver. Hermetic: identity-only for an exact token_hash match, '
  'empty on miss, no oracle. Folds is_master + current active org_ids for eligibility checks.';

-- Pre-auth path is the anon-key client (role anon). Keep it OFF PUBLIC; allow exactly the
-- two roles the edge runtime can present pre-session. authenticated is harmless (still
-- hermetic) but is included so a future authenticated management call can reuse it.
REVOKE ALL ON FUNCTION public.crm_mcp_resolve_token(char) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_mcp_resolve_token(char) TO anon, authenticated;
