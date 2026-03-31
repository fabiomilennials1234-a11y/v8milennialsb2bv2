-- Pipeline display configuration: controls naming and visibility of default funnels per org
CREATE TABLE IF NOT EXISTS public.pipeline_display_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pipe_type TEXT NOT NULL CHECK (pipe_type IN ('whatsapp', 'confirmacao', 'propostas', 'upsell')),
  display_name TEXT NOT NULL,
  is_visible BOOLEAN NOT NULL DEFAULT true,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, pipe_type)
);

CREATE INDEX idx_pipeline_display_config_org ON pipeline_display_config(organization_id);

-- RLS
ALTER TABLE pipeline_display_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org pipeline config"
  ON pipeline_display_config FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM team_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can update own org pipeline config"
  ON pipeline_display_config FOR UPDATE
  USING (organization_id IN (
    SELECT organization_id FROM team_members WHERE user_id = auth.uid() AND role = 'admin'
  ));

CREATE POLICY "Admins can insert own org pipeline config"
  ON pipeline_display_config FOR INSERT
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM team_members WHERE user_id = auth.uid() AND role = 'admin'
  ));

-- Seed defaults for ALL existing organizations
INSERT INTO pipeline_display_config (organization_id, pipe_type, display_name, is_visible, position)
SELECT o.id, cfg.pipe_type, cfg.display_name, cfg.is_visible, cfg.position
FROM organizations o
CROSS JOIN (VALUES
  ('whatsapp', 'Oportunidades', true, 1),
  ('confirmacao', 'Agendamentos', true, 2),
  ('propostas', 'Orçamentos', true, 3),
  ('upsell', 'Carteira', true, 4)
) AS cfg(pipe_type, display_name, is_visible, position)
ON CONFLICT (organization_id, pipe_type) DO NOTHING;

-- RPC to ensure config exists for an org (called during onboarding or first sidebar load)
CREATE OR REPLACE FUNCTION public.ensure_pipeline_display_config(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO pipeline_display_config (organization_id, pipe_type, display_name, is_visible, position)
  VALUES
    (p_org_id, 'whatsapp', 'Oportunidades', true, 1),
    (p_org_id, 'confirmacao', 'Agendamentos', true, 2),
    (p_org_id, 'propostas', 'Orçamentos', true, 3),
    (p_org_id, 'upsell', 'Carteira', true, 4)
  ON CONFLICT (organization_id, pipe_type) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_pipeline_display_config(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_pipeline_display_config(UUID) TO service_role;
