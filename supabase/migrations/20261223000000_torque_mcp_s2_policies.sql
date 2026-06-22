-- 20261223000000_torque_mcp_s2_policies.sql
-- S2 mutating pack (docs/adr/0011): minimal write surface for the MCP master.

-- 1) copilot.update_prompt writes copilot_agents directly via master JWT.
--    copilot_agents has master_select_all (SELECT) but no master UPDATE → add it.
DROP POLICY IF EXISTS "master_update_all_copilot_agents" ON public.copilot_agents;
CREATE POLICY "master_update_all_copilot_agents" ON public.copilot_agents
  FOR UPDATE USING (public.is_master_user()) WITH CHECK (public.is_master_user());

-- 2) cron.toggle: pg_cron is privileged (cron schema, no RLS). Wrap the active-flag
--    flip in a SECURITY DEFINER RPC granted to service_role only. Toggles, never deletes.
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
