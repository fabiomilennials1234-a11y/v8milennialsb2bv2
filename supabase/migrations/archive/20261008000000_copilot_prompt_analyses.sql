-- Copilot Prompt Analyses — stores conversation analysis results
CREATE TABLE public.copilot_prompt_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.copilot_agents(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
  accepted_ids TEXT[] NOT NULL DEFAULT '{}',
  dismissed_ids TEXT[] NOT NULL DEFAULT '{}',
  conversation_count INTEGER NOT NULL DEFAULT 0,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.copilot_prompt_analyses ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_prompt_analyses_agent
  ON public.copilot_prompt_analyses (agent_id, created_at DESC);

CREATE INDEX idx_prompt_analyses_org
  ON public.copilot_prompt_analyses (organization_id);

-- RLS: org members can read their own analyses
CREATE POLICY "prompt_analyses_select_own_org"
  ON public.copilot_prompt_analyses FOR SELECT
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      WHERE tm.user_id = (SELECT auth.uid()) AND tm.is_active = true
    )
  );

-- RLS: org members can insert for their own org
CREATE POLICY "prompt_analyses_insert_own_org"
  ON public.copilot_prompt_analyses FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      WHERE tm.user_id = (SELECT auth.uid()) AND tm.is_active = true
    )
  );

-- RLS: org members can update their own analyses (accept/dismiss)
CREATE POLICY "prompt_analyses_update_own_org"
  ON public.copilot_prompt_analyses FOR UPDATE
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      WHERE tm.user_id = (SELECT auth.uid()) AND tm.is_active = true
    )
  );

-- Master access
CREATE POLICY "prompt_analyses_master_all"
  ON public.copilot_prompt_analyses FOR ALL
  USING (public.is_master_user());
