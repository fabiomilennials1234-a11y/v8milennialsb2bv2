-- 20261223000000_torque_mcp_s2_policies.sql
-- S2 mutating pack (docs/adr/0011): privileged path for cron.toggle.
--
-- copilot.update_prompt needs NO new policy: copilot_agents already has
-- "master_all_copilot_agents" FOR ALL USING (is_master_user()) from
-- 20260131200001_master_rls_policies.sql, which already covers the master UPDATE.
-- (Verified 2026-06-22 during S2 code review — avoids a redundant policy.)
--
-- cron.toggle: pg_cron is privileged (cron schema, no RLS). Wrap the active-flag
-- flip in a SECURITY DEFINER RPC granted to service_role only. Toggles, never deletes.

CREATE OR REPLACE FUNCTION public.toggle_cron_job(p_jobname text, p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = p_jobname;
  IF v_jobid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'job not found: ' || p_jobname);
  END IF;
  PERFORM cron.alter_job(v_jobid, active := p_enabled);
  RETURN jsonb_build_object('ok', true, 'jobname', p_jobname, 'jobid', v_jobid, 'active', p_enabled);
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_cron_job(text, boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_cron_job(text, boolean) TO service_role;
