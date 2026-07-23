-- =============================================================================
-- Copilot Builder foundation (PRD #544 / Slice #545)
-- =============================================================================
-- Adds the persistence the Copilot Builder needs:
--   1. builder_sessions — the persistent, re-openable conversation between a
--      user and the Builder for a given agent (1:1 with the agent).
--   2. copilot_agents.finalized_at — NULL marks a draft (in-progress build,
--      hidden from the main agents list); a timestamp marks a real agent.
--   3. feature flag copilot_builder enabled ONLY for the Milennials org
--      (phase 1). Going global later is just a flag flip.
--
-- Schema ships to all orgs (harmless); only orgs with the flag can use it.
-- =============================================================================

-- 1. Draft marker -------------------------------------------------------------
ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz;

COMMENT ON COLUMN public.copilot_agents.finalized_at IS
  'NULL = Builder draft (in-progress, hidden from the main agents list, never default). Timestamp = finalized agent; is_active then toggles paused/active normally.';

-- 2. Builder Session ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.builder_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.copilot_agents(id) ON DELETE CASCADE,
  -- Append-only transcript of the interview. Each entry: { role, content, ... }.
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Backbone interview topics already covered (drives progress + soft gate).
  covered_topics text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One Builder Session per agent.
  CONSTRAINT builder_sessions_unique_agent UNIQUE (agent_id)
);

CREATE INDEX IF NOT EXISTS idx_builder_sessions_org
  ON public.builder_sessions (organization_id, updated_at DESC);

ALTER TABLE public.builder_sessions ENABLE ROW LEVEL SECURITY;

-- Org members manage their own org's Builder Sessions. The edge function uses
-- the service role (bypasses RLS) to append messages / drive the build.
CREATE POLICY builder_sessions_select_org ON public.builder_sessions
  FOR SELECT
  USING (organization_id IN (SELECT get_my_organization_ids()));

CREATE POLICY builder_sessions_insert_org ON public.builder_sessions
  FOR INSERT
  WITH CHECK (organization_id IN (SELECT get_my_organization_ids()));

CREATE POLICY builder_sessions_update_org ON public.builder_sessions
  FOR UPDATE
  USING (organization_id IN (SELECT get_my_organization_ids()))
  WITH CHECK (organization_id IN (SELECT get_my_organization_ids()));

CREATE POLICY builder_sessions_delete_org ON public.builder_sessions
  FOR DELETE
  USING (organization_id IN (SELECT get_my_organization_ids()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.builder_sessions TO authenticated;

COMMENT ON TABLE public.builder_sessions IS
  'Persistent, re-openable Copilot Builder conversation for a given agent (1:1). Distinct from a runtime Conversation (agent <-> lead). See PRD #544.';

-- 3. Phase-1 rollout: Milennials only -----------------------------------------
UPDATE public.organizations
   SET feature_flags = COALESCE(feature_flags, '{}'::jsonb)
                       || '{"copilot_builder": true}'::jsonb
 WHERE id = '6030520a-2ca7-477d-be89-55758e2cd808';
