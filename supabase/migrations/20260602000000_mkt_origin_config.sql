-- ============================================================
-- Marketing Origin Config table
-- Stores per-origin investment + metric visibility per month/year
-- ============================================================

CREATE TABLE IF NOT EXISTS public.mkt_origin_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  origin TEXT NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INTEGER NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  investimento_cents BIGINT NOT NULL DEFAULT 0,
  show_leads BOOLEAN NOT NULL DEFAULT true,
  show_agendamentos BOOLEAN NOT NULL DEFAULT true,
  show_comparecimentos BOOLEAN NOT NULL DEFAULT true,
  show_propostas BOOLEAN NOT NULL DEFAULT true,
  show_vendas BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, origin, month, year)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_mkt_origin_config_org_period
  ON public.mkt_origin_config(organization_id, month, year);

-- RLS
ALTER TABLE public.mkt_origin_config ENABLE ROW LEVEL SECURITY;

-- Select: any authenticated member of the org
CREATE POLICY "mkt_origin_config_select"
  ON public.mkt_origin_config FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.user_id = auth.uid()
        AND tm.organization_id = mkt_origin_config.organization_id
        AND tm.is_active = true
    )
  );

-- Insert: admin only
CREATE POLICY "mkt_origin_config_insert"
  ON public.mkt_origin_config FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    AND EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.user_id = auth.uid()
        AND tm.organization_id = mkt_origin_config.organization_id
        AND tm.is_active = true
    )
  );

-- Update: admin only
CREATE POLICY "mkt_origin_config_update"
  ON public.mkt_origin_config FOR UPDATE
  USING (
    public.has_role(auth.uid(), 'admin')
    AND EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.user_id = auth.uid()
        AND tm.organization_id = mkt_origin_config.organization_id
        AND tm.is_active = true
    )
  );

-- Delete: admin only
CREATE POLICY "mkt_origin_config_delete"
  ON public.mkt_origin_config FOR DELETE
  USING (
    public.has_role(auth.uid(), 'admin')
    AND EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.user_id = auth.uid()
        AND tm.organization_id = mkt_origin_config.organization_id
        AND tm.is_active = true
    )
  );

-- updated_at trigger
CREATE OR REPLACE TRIGGER mkt_origin_config_updated_at
  BEFORE UPDATE ON public.mkt_origin_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
