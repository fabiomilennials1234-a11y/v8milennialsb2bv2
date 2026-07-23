-- 20260608000009_followup_situation_config_master_rls.sql
-- Master users manage every org's follow-up config (shadow mode), mirroring the
-- legacy copilot_agent_followup_rules master policies. Without this a Master
-- viewing another org could neither read nor toggle the situations.

CREATE POLICY "master_all" ON public.copilot_followup_situation_config
  FOR ALL
  USING (public.is_master_user())
  WITH CHECK (public.is_master_user());
