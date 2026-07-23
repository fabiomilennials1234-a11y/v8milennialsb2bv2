-- =============================================================================
-- builder_sessions: master RLS bypass (PRD #544 / Slice #545 follow-up)
-- =============================================================================
-- builder_sessions only had tenant-isolation policies via
-- get_my_organization_ids(). A Master operating in shadow mode (viewing another
-- org) is not a team member of that org, so get_my_organization_ids() excludes
-- it and the Builder Session row is invisible to the master — the panel shows
-- nothing even though the edge function (service role) persisted the turn.
--
-- Mirror the master bypass used on copilot_agents and the other master-scoped
-- tables: a dedicated policy granting masters full access.
-- =============================================================================

CREATE POLICY master_all_builder_sessions ON public.builder_sessions
  FOR ALL
  USING (is_master_user())
  WITH CHECK (is_master_user());
