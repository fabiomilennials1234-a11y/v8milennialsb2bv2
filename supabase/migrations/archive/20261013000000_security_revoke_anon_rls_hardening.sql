-- ============================================================================
-- Migration: Security hardening — revoke anon grants, restrict functions, enable RLS
-- Fixes: W1-3, W1-4, W1-5, W1-6 from security audit
-- ============================================================================

BEGIN;

-- ============================================================================
-- W1-3: Revoke SELECT on pipe views from anon
-- Originally granted in 20260984000000_fix_compat_views_stage_id.sql (lines 357-359)
-- These views expose tenant pipeline data — anon must never read them.
-- ============================================================================

REVOKE SELECT ON public.pipe_whatsapp    FROM anon;
REVOKE SELECT ON public.pipe_confirmacao FROM anon;
REVOKE SELECT ON public.pipe_propostas   FROM anon;

-- ============================================================================
-- W1-4: Revoke anon access to check_rate_limit SECURITY DEFINER function
-- Originally granted in 20260909200000_create_rate_limits.sql (line 83)
-- Anon callers could pre-fill rate-limit counters and lock out legitimate users.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INT, INT) FROM anon;

-- ============================================================================
-- W1-5: Restrict get_jobs_overview to master users only
-- Originally defined in 20260801000000_create_automation_jobs.sql (lines 90-107)
-- SECURITY DEFINER with no auth check — any authenticated user sees cross-org data.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_jobs_overview(interval_param TEXT DEFAULT '24 hours')
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_master_user() THEN
    RAISE EXCEPTION 'Forbidden: master access required';
  END IF;

  RETURN (
    SELECT json_build_object(
      'total',       COUNT(*),
      'success',     COUNT(*) FILTER (WHERE status = 'success'),
      'failed',      COUNT(*) FILTER (WHERE status = 'failed'),
      'dead_letter', COUNT(*) FILTER (WHERE status = 'dead_letter'),
      'retrying',    COUNT(*) FILTER (WHERE status = 'retrying'),
      'running',     COUNT(*) FILTER (WHERE status = 'running')
    )
    FROM public.automation_jobs
    WHERE created_at > NOW() - interval_param::INTERVAL
  );
END;
$$;

COMMENT ON FUNCTION public.get_jobs_overview IS 'Retorna resumo agregado de automation_jobs para o Operations Center. Restrito a master users.';

-- Restrict to service_role only (master check handles authenticated callers internally)
REVOKE EXECUTE ON FUNCTION public.get_jobs_overview(TEXT) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_jobs_overview(TEXT) TO service_role;

-- ============================================================================
-- W1-6a: Enable RLS on exchange_rates
-- Created in 20260961000000_deal_enhancement.sql (line 118) without RLS.
-- Global reference data — authenticated read, service_role write.
-- ============================================================================

ALTER TABLE IF EXISTS public.exchange_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "exchange_rates_service_role" ON public.exchange_rates
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "exchange_rates_read" ON public.exchange_rates
  FOR SELECT TO authenticated USING (true);

-- ============================================================================
-- W1-6b: Enable RLS on _lead_duplicates_audit
-- Created in 20260130100000_lead_phone_centralization.sql (line 106) without RLS.
-- Internal audit table — service_role only.
-- ============================================================================

ALTER TABLE IF EXISTS public._lead_duplicates_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "_lead_duplicates_audit_service_role" ON public._lead_duplicates_audit
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
