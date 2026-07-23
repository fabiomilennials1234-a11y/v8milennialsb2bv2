-- =============================================================================
-- Tabela: copilot_agent_audios
-- Armazena áudios pré-gravados para abordagem outbound dos copilots
-- =============================================================================

CREATE TABLE public.copilot_agent_audios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.copilot_agents(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  storage_path TEXT NOT NULL,
  public_url TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'audio/ogg',
  file_size INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_copilot_agent_audios_agent ON public.copilot_agent_audios(agent_id);
CREATE INDEX idx_copilot_agent_audios_org ON public.copilot_agent_audios(organization_id);

-- RLS
ALTER TABLE public.copilot_agent_audios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_read_agent_audios"
  ON public.copilot_agent_audios FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "team_insert_agent_audios"
  ON public.copilot_agent_audios FOR INSERT
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "team_update_agent_audios"
  ON public.copilot_agent_audios FOR UPDATE
  USING (organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "team_delete_agent_audios"
  ON public.copilot_agent_audios FOR DELETE
  USING (organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "service_role_all_agent_audios"
  ON public.copilot_agent_audios FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
