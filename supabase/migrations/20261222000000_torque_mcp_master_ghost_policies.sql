-- 20261222000000_torque_mcp_master_ghost_policies.sql
--
-- Torque MCP (docs/adr/0011) authenticates as a real master user via JWT and
-- queries every table with RLS ON (RLS-inherited security model). That only
-- works if each table the read pack touches has a master-ghost SELECT policy
-- (USING is_master_user()). A schema audit (2026-06-22) found these tables
-- missing one, so a master would silently see zero rows cross-org.
--
-- This adds SELECT-only master-ghost policies (least privilege — the read pack
-- never writes). Mutating tools (phase 2) will add FOR ALL where needed.
-- Also closes a recurring "master-ghost gap" class seen across incidents.
--
-- Scope note: a verification pass (2026-06-22) confirmed the other read-pack
-- tables ALREADY carry a master-ghost policy and are deliberately NOT touched
-- here: leads (master_all_leads), pipelines (master_all_pipelines, 20260509010000),
-- pipeline_entries (master_select_all_pipeline_entries, 20260509010000),
-- lead_history (20260607000000), meetings (master_all_meetings, 20260985000000),
-- audit_log/deleted_leads_log/conversations/whatsapp_messages/whatsapp_instances,
-- copilot_agents (20260131200001), copilot_agent_faqs (20260607000000).
-- Only the 5 below were genuinely missing.
--
-- SECURITY: is_master_user() is SECURITY DEFINER STABLE and reads master_users
-- directly — no inline `SELECT FROM team_members`, so it is safe under Realtime
-- apply_rls() (avoids the recursion hazard documented in the root CLAUDE.md).
--
-- Idempotent: DROP POLICY IF EXISTS before CREATE so a future RLS rebuild that
-- re-runs this file (or a partial prior apply) does not error.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'whatsapp_conversation_summary',
    'uazapi_sender_jobs',
    'blast_plans',
    'blast_plan_recipients',
    'blast_daily_usage'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Skip cleanly if a table is absent in this environment (defensive).
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'torque-mcp master-ghost: table public.% not found, skipping', t;
      CONTINUE;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'master_select_all_' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (public.is_master_user())',
      'master_select_all_' || t,
      t
    );
  END LOOP;
END $$;
