-- =============================================================================
-- CRITICAL SECURITY FIX: pre-auth + cross-org leak on conversation tables
-- =============================================================================
--
-- INCIDENT (2026-06-01, verified empirically against PROD with the public anon key):
-- An UNAUTHENTICATED attacker (anon key, shipped in the frontend JS bundle) could
-- read cross-org:
--   - conversation_messages  (1736 rows, includes `content` = message bodies)
--   - conversations          (925 rows across 14 distinct organizations)
--   - conversation_context_summary
-- and, because the anon role also held INSERT/UPDATE/DELETE grants, could WRITE/DELETE them.
--
-- ROOT CAUSE: policies created as "service role" policies but left as roles={public}
-- with `USING (true)` (no `TO service_role`). Postgres applies {public} policies to
-- ALL roles (anon + authenticated). Permissive policies are OR-combined, so a single
-- `{public} USING(true)` policy overrode every org-scoped policy -> full public RW,
-- bypassing tenant isolation. Migration 20261012000000 added the correct
-- `*_service_role_full_access` (auth.role()='service_role') policies but did NOT drop
-- the old permissive ones; prod migration drift kept them live.
--
-- This migration is IDEMPOTENT and matches the hotfix already applied to prod via
-- `supabase db query --linked`. It must also be applied to DEV.
-- =============================================================================

BEGIN;

-- ── 1. Remove the permissive {public} USING(true) leak policies ──────────────
-- conversations: org-scoped SELECT/UPDATE + conversations_service_role_full_access
-- (auth.role()='service_role') remain and cover all legitimate access.
DROP POLICY IF EXISTS "service_role_conversations_all"        ON public.conversations;
DROP POLICY IF EXISTS "Service role full access conversations" ON public.conversations;

-- conversation_messages: conv_messages_select_org +
-- conversation_messages_service_role_full_access remain.
DROP POLICY IF EXISTS "service_role_conv_messages_all"     ON public.conversation_messages;
DROP POLICY IF EXISTS "Service role full access messages"  ON public.conversation_messages;

-- conversation_context_summary: drop the permissive ALL policy and replace with a
-- properly-scoped service_role policy (it was the only write path for the backend).
DROP POLICY IF EXISTS "System can manage context" ON public.conversation_context_summary;

DROP POLICY IF EXISTS "conversation_context_summary_service_role" ON public.conversation_context_summary;
CREATE POLICY "conversation_context_summary_service_role"
  ON public.conversation_context_summary
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 2. Revoke the over-broad anon grants (defense in depth) ──────────────────
-- anon must never read/write tenant or PII data. The frontend uses the
-- `authenticated` role (separate grant, untouched); backend uses service_role.
REVOKE ALL ON public.conversations               FROM anon;
REVOKE ALL ON public.conversation_messages        FROM anon;
REVOKE ALL ON public.conversation_context_summary FROM anon;
REVOKE ALL ON public.system_alerts                FROM anon;
REVOKE ALL ON public.audit_log                    FROM anon;
REVOKE ALL ON public.channel_messages             FROM anon;
REVOKE ALL ON public.lead_history                 FROM anon;
REVOKE ALL ON public.runtime_logs                 FROM anon;
REVOKE ALL ON public.whatsapp_messages            FROM anon;

COMMIT;

-- ── 3. Close pre-auth RPC leak: SECURITY DEFINER functions executable by anon ─
-- These DEFINER functions take an org_id param and bypass RLS. With PUBLIC/anon
-- EXECUTE, an unauthenticated attacker read any org's financials/portfolio/leads
-- (confirmed: anon called get_dashboard_metrics -> MRR/revenue cross-org).
-- Revoke PUBLIC+anon; keep authenticated (UI) + service_role (cron).
-- Membership guards (authenticated cross-org) tracked separately (SD-1..5).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname = ANY (ARRAY[
      'create_lead_with_pipe','get_analytics_overview_metrics','get_analytics_commercial_metrics',
      'get_analytics_financial_metrics','get_analytics_pipeline_metrics','get_analytics_engagement_metrics',
      'get_mkt_origin_metrics','get_dashboard_metrics','get_portfolio_kpis','get_portfolio_clients',
      'get_portfolio_trends','get_revenue_at_risk','get_vendedor_ranking','get_seller_activity_scores',
      'get_product_ranking','get_leads_team_no_response','get_leads_no_response_from_lead',
      'get_leads_not_confirmed','get_followup_eligible_leads','org_get_subscription_status',
      'org_get_seat_usage','org_resolve_quota','org_resolve_all_quotas','check_oraculo_limit'])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
  -- internal-only helpers: also revoke authenticated, keep service_role
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname = ANY (ARRAY['record_oraculo_usage','apply_channel_message_to_meta_conversation'])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- ── 4. RLS-006: user_roles no longer lists every master/admin cross-org ──────
BEGIN;
DROP POLICY IF EXISTS "Roles visíveis para autenticados" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_select_self" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_select_org_admin" ON public.user_roles;
CREATE POLICY "user_roles_select_self" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "user_roles_select_org_admin" ON public.user_roles
  FOR SELECT TO authenticated
  USING (public.is_master_user()
     OR user_id IN (SELECT tm.user_id FROM public.team_members tm
                    WHERE tm.organization_id IN (SELECT public.get_my_admin_organization_ids())));
COMMIT;

-- NOTE (not done here — requires verifying public/anon write flows first):
--  * anon still holds SELECT + INSERT/UPDATE/DELETE on ~213 public tables via a
--    blanket grant. RLS is the only guard. Harden with a scoped revoke of anon
--    writes, keeping only the genuine public-form insert targets.
--  * Leftover backup table public.pipeline_entries_revert_20260514 still exists
--    (anon already revoked). DROP it after confirming it is unused.
