-- =============================================================================
-- Migration: conversation_read_state
-- Purpose  : Server-side tracking of per-user last-read position per
--            conversation. Replaces client-side localStorage pattern
--            (whatsapp_last_seen_*) used in UnreadDivider (Onda 1).
--            localStorage was problematic: leaked between browser sessions on
--            shared machines, did not persist across devices, and had no RLS.
-- Author   : DBA agent — 2026-04-22
-- =============================================================================

-- =============================================================================
-- UP
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLE
-- ---------------------------------------------------------------------------

CREATE TABLE public.conversation_read_state (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  user_id          uuid        NOT NULL,
  -- Format: ${channel}:${instance_id}:${contact_phone}
  -- Examples:
  --   whatsapp:inst_abc123:+5511999990000
  --   meta:page_456:+5511888880000      (futuro)
  --   szchat:ws_789:+5511777770000      (futuro)
  -- Kept as text (not split into columns) because the composite key is always
  -- treated as an opaque token by callers; splitting adds no query benefit and
  -- complicates index lookups.
  conversation_key text        NOT NULL,
  last_read_at     timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT conversation_read_state_pkey PRIMARY KEY (id),

  -- Referential integrity: cascade delete keeps orphaned rows from
  -- accumulating when an org or user is removed.
  CONSTRAINT conversation_read_state_organization_id_fkey
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations (id)
    ON DELETE CASCADE,

  CONSTRAINT conversation_read_state_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES auth.users (id)
    ON DELETE CASCADE,

  -- Business invariant: exactly one read-state record per (org, user,
  -- conversation). The UPSERT path in the frontend relies on this constraint
  -- for ON CONFLICT DO UPDATE.
  CONSTRAINT conversation_read_state_unique_per_user_conversation
    UNIQUE (organization_id, user_id, conversation_key)
);

-- ---------------------------------------------------------------------------
-- COMMENTS
-- ---------------------------------------------------------------------------

COMMENT ON TABLE public.conversation_read_state IS
  'Tracks last-read timestamp per user per conversation. Replaces client-side localStorage. Multi-tenant via organization_id + user_id + RLS.';

COMMENT ON COLUMN public.conversation_read_state.conversation_key IS
  'Format: ${channel}:${instance_id}:${contact_phone}. Extensible to Meta, SZ.Chat, email channels.';

COMMENT ON COLUMN public.conversation_read_state.last_read_at IS
  'Timestamp of the last message the user saw. Updated on conversation open and scroll-to-bottom.';

COMMENT ON COLUMN public.conversation_read_state.organization_id IS
  'Multi-tenancy boundary. Always equals the org returned by get_user_organization_id() for the acting user.';

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------

-- NOTE: The UNIQUE constraint above (organization_id, user_id, conversation_key)
-- already creates a B-tree index that covers the primary lookup pattern:
--   WHERE organization_id = $1 AND user_id = $2 AND conversation_key = $3
-- No additional index needed for that pattern.

-- Secondary index: list conversations ordered by recency for a given user.
-- Anticipated query: "show me all conversations this user has opened, newest
-- first" — used by future inbox or notification features.
-- Partial index not warranted here because there is no low-cardinality filter
-- to push down; all rows are active by definition.
CREATE INDEX conversation_read_state_user_recent_idx
  ON public.conversation_read_state (organization_id, user_id, last_read_at DESC);

-- ---------------------------------------------------------------------------
-- TRIGGER: maintain updated_at automatically
-- ---------------------------------------------------------------------------

-- public.update_updated_at() is defined in migration
-- 20260106163946_b4e4b708-0101-49be-b7f9-096fcad26bbe.sql as a SECURITY
-- DEFINER trigger function with SET search_path = public. It is stable across
-- the project; we do NOT redefine it here.
CREATE TRIGGER set_conversation_read_state_updated_at
  BEFORE UPDATE ON public.conversation_read_state
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.conversation_read_state ENABLE ROW LEVEL SECURITY;

-- Policy design notes:
--
-- org boundary: public.get_user_organization_id() is STABLE SECURITY DEFINER,
-- reads team_members WHERE user_id = auth.uid() AND is_active = true.
-- This is the canonical org-resolution function used project-wide (confirmed
-- in migrations 20260303000000, 20260320000000, 20260600000000, etc.).
-- NOT using a subquery on user_organizations because that table does not
-- exist — the org membership is tracked via team_members.
--
-- user boundary: user_id = auth.uid() is the primary guard. Even within the
-- same org, a user must not read or write another user's read state. This is
-- intentional: read-state is personal, not shared.
--
-- master bypass: public.is_master_user() checks master_users table
-- (STABLE SECURITY DEFINER). Pattern consistent with master_rls_policies
-- migration (20260131200001). Master needs visibility for support/debug.
-- Master INSERT/UPDATE via the ALL policy also covers WITH CHECK implicitly
-- (Postgres OR-combines permissive policies), but we add a dedicated
-- SELECT policy for clarity and symmetry with the rest of the codebase.

-- SELECT: user sees only their own rows in their org.
-- Master sees all (support/debug).
CREATE POLICY "users_read_own_conversation_read_state"
  ON public.conversation_read_state
  FOR SELECT
  TO authenticated
  USING (
    public.is_master_user()
    OR (
      user_id = auth.uid()
      AND organization_id = public.get_user_organization_id()
    )
  );

-- INSERT: user can only insert for themselves in their active org.
-- WITH CHECK (not USING) is the correct clause for INSERT.
-- Prevents a compromised client from inserting with a forged organization_id.
CREATE POLICY "users_insert_own_conversation_read_state"
  ON public.conversation_read_state
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_master_user()
    OR (
      user_id = auth.uid()
      AND organization_id = public.get_user_organization_id()
    )
  );

-- UPDATE: USING filters which rows the user can see to update;
-- WITH CHECK validates the proposed NEW values.
-- Both clauses are required: USING alone would still allow a user to
-- rewrite organization_id on their own rows to another org's UUID.
CREATE POLICY "users_update_own_conversation_read_state"
  ON public.conversation_read_state
  FOR UPDATE
  TO authenticated
  USING (
    public.is_master_user()
    OR (
      user_id = auth.uid()
      AND organization_id = public.get_user_organization_id()
    )
  )
  WITH CHECK (
    public.is_master_user()
    OR (
      user_id = auth.uid()
      AND organization_id = public.get_user_organization_id()
    )
  );

-- DELETE: user_id = auth.uid() is sufficient to prevent cross-user deletes.
-- No org check in USING here because user_id already uniquely identifies
-- ownership; adding org check would be redundant given the UNIQUE constraint
-- ties every row to exactly one org.
-- Master bypass included for completeness (e.g. purging a user's data).
CREATE POLICY "users_delete_own_conversation_read_state"
  ON public.conversation_read_state
  FOR DELETE
  TO authenticated
  USING (
    public.is_master_user()
    OR user_id = auth.uid()
  );

-- =============================================================================
-- ROLLBACK (manual — descomentar e executar se necessário)
-- Execute na ordem exata abaixo para respeitar dependências.
-- Policies primeiro, trigger segundo, index terceiro, tabela por último.
-- =============================================================================
-- DROP POLICY IF EXISTS "users_delete_own_conversation_read_state"  ON public.conversation_read_state;
-- DROP POLICY IF EXISTS "users_update_own_conversation_read_state"  ON public.conversation_read_state;
-- DROP POLICY IF EXISTS "users_insert_own_conversation_read_state"  ON public.conversation_read_state;
-- DROP POLICY IF EXISTS "users_read_own_conversation_read_state"    ON public.conversation_read_state;
-- DROP TRIGGER  IF EXISTS set_conversation_read_state_updated_at    ON public.conversation_read_state;
-- DROP INDEX    IF EXISTS public.conversation_read_state_user_recent_idx;
-- DROP TABLE    IF EXISTS public.conversation_read_state;
