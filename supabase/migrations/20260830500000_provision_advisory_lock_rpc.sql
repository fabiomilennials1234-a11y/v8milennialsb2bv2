-- ================================================================
-- Migration: Advisory lock RPC for checkout-provision-org
--
-- Provides a simple RPC to acquire a transactional advisory lock
-- keyed on user_id. Prevents double-provisioning when both the
-- card fire-and-forget and webhook arrive simultaneously.
-- Date: 2026-08-30
-- ================================================================

CREATE OR REPLACE FUNCTION public.try_provision_lock(p_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- pg_try_advisory_xact_lock returns true if lock acquired, false if already held.
  -- The lock is automatically released at the end of the current transaction.
  RETURN pg_try_advisory_xact_lock(hashtext(p_user_id));
END;
$$;

COMMENT ON FUNCTION public.try_provision_lock IS
  'Attempts to acquire a transactional advisory lock for org provisioning. '
  'Returns true if acquired, false if another process holds it. '
  'Lock is released automatically at transaction end.';

GRANT EXECUTE ON FUNCTION public.try_provision_lock(TEXT)
  TO service_role;
