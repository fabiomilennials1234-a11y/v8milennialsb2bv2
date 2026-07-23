-- ============================================================================
-- Wave 1.2 — Pipeline Consolidation
-- ============================================================================
-- Unifies pipe_whatsapp, pipe_confirmacao, pipe_propostas + custom_pipe_entries
-- into a single pipelines + pipeline_entries model.
-- Existing tables are NOT dropped — backward compat via views.
-- ============================================================================

-- ============================================================================
-- 1. pipelines (unified registry)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.pipelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'custom' CHECK (type IN ('system', 'custom')),
  description TEXT,
  icon TEXT DEFAULT 'kanban',
  color TEXT DEFAULT '#3b82f6',
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  config JSONB DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_pipelines_org
  ON public.pipelines (organization_id);

CREATE INDEX IF NOT EXISTS idx_pipelines_org_active
  ON public.pipelines (organization_id, is_active);

CREATE TRIGGER update_pipelines_updated_at
  BEFORE UPDATE ON public.pipelines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- RLS
ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pipelines_select" ON public.pipelines FOR SELECT
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "pipelines_insert" ON public.pipelines FOR INSERT
  WITH CHECK (organization_id = public.get_user_organization_id());

CREATE POLICY "pipelines_update" ON public.pipelines FOR UPDATE
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "pipelines_delete" ON public.pipelines FOR DELETE
  USING (organization_id = public.get_user_organization_id());

-- ============================================================================
-- 2. pipeline_entries (unified pipe entries)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.pipeline_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL,
  stage_key TEXT NOT NULL,
  assigned_to UUID REFERENCES public.team_members(id) ON DELETE SET NULL,
  notes TEXT,
  metadata JSONB DEFAULT '{}',
  entered_at TIMESTAMPTZ DEFAULT NOW(),
  stage_changed_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_entries_org
  ON public.pipeline_entries (organization_id);

CREATE INDEX IF NOT EXISTS idx_pipeline_entries_pipeline
  ON public.pipeline_entries (pipeline_id);

CREATE INDEX IF NOT EXISTS idx_pipeline_entries_lead
  ON public.pipeline_entries (lead_id) WHERE lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pipeline_entries_deal
  ON public.pipeline_entries (deal_id) WHERE deal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pipeline_entries_stage
  ON public.pipeline_entries (stage_key);

CREATE INDEX IF NOT EXISTS idx_pipeline_entries_assigned
  ON public.pipeline_entries (assigned_to) WHERE assigned_to IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_entries_pipeline_lead
  ON public.pipeline_entries (pipeline_id, lead_id)
  WHERE lead_id IS NOT NULL;

CREATE TRIGGER update_pipeline_entries_updated_at
  BEFORE UPDATE ON public.pipeline_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- RLS
ALTER TABLE public.pipeline_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pipeline_entries_select" ON public.pipeline_entries FOR SELECT
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "pipeline_entries_insert" ON public.pipeline_entries FOR INSERT
  WITH CHECK (organization_id = public.get_user_organization_id());

CREATE POLICY "pipeline_entries_update" ON public.pipeline_entries FOR UPDATE
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "pipeline_entries_delete" ON public.pipeline_entries FOR DELETE
  USING (organization_id = public.get_user_organization_id());

-- ============================================================================
-- 3. Seed system pipelines for existing orgs
-- ============================================================================

DO $$
DECLARE
  v_org RECORD;
BEGIN
  FOR v_org IN SELECT id FROM public.organizations LOOP
    INSERT INTO public.pipelines (organization_id, name, slug, type, display_order, icon, color)
    VALUES
      (v_org.id, 'Qualificação', 'whatsapp',    'system', 0, 'zap',         '#22c55e'),
      (v_org.id, 'Confirmação',  'confirmacao',  'system', 1, 'calendar',    '#3b82f6'),
      (v_org.id, 'Propostas',    'propostas',    'system', 2, 'dollar-sign', '#f59e0b')
    ON CONFLICT (organization_id, slug) DO NOTHING;
  END LOOP;
END $$;

-- Auto-create system pipelines for new orgs
CREATE OR REPLACE FUNCTION public.create_default_pipelines(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.pipelines (organization_id, name, slug, type, display_order, icon, color)
  VALUES
    (p_org_id, 'Qualificação', 'whatsapp',    'system', 0, 'zap',         '#22c55e'),
    (p_org_id, 'Confirmação',  'confirmacao',  'system', 1, 'calendar',    '#3b82f6'),
    (p_org_id, 'Propostas',    'propostas',    'system', 2, 'dollar-sign', '#f59e0b')
  ON CONFLICT (organization_id, slug) DO NOTHING;
END;
$$;

-- Update the org-creation trigger to also create pipelines
CREATE OR REPLACE FUNCTION public.trigger_create_default_stages()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.create_default_pipeline_stages(NEW.id);
  PERFORM public.create_default_pipelines(NEW.id);
  RETURN NEW;
END;
$$;

-- Trigger already exists (on_organization_created_stages) — no need to recreate.
-- The OR REPLACE on the function body is sufficient.

-- ============================================================================
-- 4. Migrate custom_pipelines → pipelines
-- ============================================================================

INSERT INTO public.pipelines (
  id, organization_id, name, slug, type, description,
  icon, color, display_order, is_active, created_by, created_at, updated_at
)
SELECT
  id, organization_id, name, slug, 'custom', description,
  icon, color, position + 3, is_active, created_by, created_at, updated_at
FROM public.custom_pipelines
ON CONFLICT (organization_id, slug) DO NOTHING;

-- ============================================================================
-- 5. Data migration RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.migrate_pipe_entries(p_batch_size INT DEFAULT 1000)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org RECORD;
  v_pipe_wpp_id UUID;
  v_pipe_conf_id UUID;
  v_pipe_prop_id UUID;
  v_wpp_count INT := 0;
  v_conf_count INT := 0;
  v_prop_count INT := 0;
  v_custom_count INT := 0;
  v_batch INT;
BEGIN
  FOR v_org IN SELECT id FROM public.organizations LOOP

    -- Resolve system pipeline IDs for this org
    SELECT id INTO v_pipe_wpp_id
    FROM public.pipelines
    WHERE organization_id = v_org.id AND slug = 'whatsapp' AND type = 'system';

    SELECT id INTO v_pipe_conf_id
    FROM public.pipelines
    WHERE organization_id = v_org.id AND slug = 'confirmacao' AND type = 'system';

    SELECT id INTO v_pipe_prop_id
    FROM public.pipelines
    WHERE organization_id = v_org.id AND slug = 'propostas' AND type = 'system';

    -- Skip org if system pipelines missing
    IF v_pipe_wpp_id IS NULL OR v_pipe_conf_id IS NULL OR v_pipe_prop_id IS NULL THEN
      CONTINUE;
    END IF;

    -- pipe_whatsapp
    WITH inserted AS (
      INSERT INTO public.pipeline_entries (
        id, organization_id, pipeline_id, lead_id, stage_key,
        assigned_to, notes, metadata, entered_at, stage_changed_at, created_at, updated_at
      )
      SELECT
        pw.id, pw.organization_id, v_pipe_wpp_id, pw.lead_id, pw.status,
        COALESCE(pw.responsible_id, pw.sdr_id),
        pw.notes,
        jsonb_strip_nulls(jsonb_build_object('scheduled_date', pw.scheduled_date)),
        pw.created_at, COALESCE(pw.stage_entered_at, pw.updated_at),
        pw.created_at, pw.updated_at
      FROM public.pipe_whatsapp pw
      WHERE pw.organization_id = v_org.id
        AND NOT EXISTS (
          SELECT 1 FROM public.pipeline_entries pe
          WHERE pe.id = pw.id
        )
      LIMIT p_batch_size
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_batch FROM inserted;
    v_wpp_count := v_wpp_count + v_batch;

    -- pipe_confirmacao
    WITH inserted AS (
      INSERT INTO public.pipeline_entries (
        id, organization_id, pipeline_id, lead_id, stage_key,
        assigned_to, notes, metadata, entered_at, stage_changed_at, created_at, updated_at
      )
      SELECT
        pc.id, pc.organization_id, v_pipe_conf_id, pc.lead_id, pc.status,
        COALESCE(pc.responsible_id, pc.sdr_id, pc.closer_id),
        pc.notes,
        jsonb_strip_nulls(jsonb_build_object(
          'meeting_date', pc.meeting_date,
          'meet_link', pc.meet_link,
          'is_confirmed', pc.is_confirmed,
          'metrics_period_at', pc.metrics_period_at
        )),
        pc.created_at, COALESCE(pc.stage_entered_at, pc.updated_at),
        pc.created_at, pc.updated_at
      FROM public.pipe_confirmacao pc
      WHERE pc.organization_id = v_org.id
        AND NOT EXISTS (
          SELECT 1 FROM public.pipeline_entries pe
          WHERE pe.id = pc.id
        )
      LIMIT p_batch_size
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_batch FROM inserted;
    v_conf_count := v_conf_count + v_batch;

    -- pipe_propostas
    WITH inserted AS (
      INSERT INTO public.pipeline_entries (
        id, organization_id, pipeline_id, lead_id, stage_key,
        assigned_to, notes, metadata, entered_at, stage_changed_at,
        closed_at, created_at, updated_at
      )
      SELECT
        pp.id, pp.organization_id, v_pipe_prop_id, pp.lead_id, pp.status,
        COALESCE(pp.responsible_id, pp.closer_id),
        pp.notes,
        jsonb_strip_nulls(jsonb_build_object(
          'sale_value', pp.sale_value,
          'product_type', pp.product_type,
          'calor', pp.calor,
          'loss_reason_id', pp.loss_reason_id,
          'commitment_date', pp.commitment_date,
          'contract_duration', pp.contract_duration,
          'metrics_period_at', pp.metrics_period_at
        )),
        pp.created_at, COALESCE(pp.stage_entered_at, pp.updated_at),
        pp.closed_at, pp.created_at, pp.updated_at
      FROM public.pipe_propostas pp
      WHERE pp.organization_id = v_org.id
        AND NOT EXISTS (
          SELECT 1 FROM public.pipeline_entries pe
          WHERE pe.id = pp.id
        )
      LIMIT p_batch_size
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_batch FROM inserted;
    v_prop_count := v_prop_count + v_batch;

    -- custom_pipe_entries
    WITH inserted AS (
      INSERT INTO public.pipeline_entries (
        id, organization_id, pipeline_id, lead_id, stage_key,
        assigned_to, notes, entered_at, stage_changed_at, created_at, updated_at
      )
      SELECT
        cpe.id, cpe.organization_id, cpe.pipeline_id, cpe.lead_id,
        COALESCE(cps.stage_key, 'unknown'),
        cpe.assigned_to,
        cpe.notes,
        cpe.entered_at, cpe.stage_changed_at,
        cpe.created_at, cpe.updated_at
      FROM public.custom_pipe_entries cpe
      LEFT JOIN public.custom_pipeline_stages cps ON cps.id = cpe.stage_id
      WHERE cpe.organization_id = v_org.id
        AND NOT EXISTS (
          SELECT 1 FROM public.pipeline_entries pe
          WHERE pe.id = cpe.id
        )
      LIMIT p_batch_size
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_batch FROM inserted;
    v_custom_count := v_custom_count + v_batch;

  END LOOP;

  RETURN jsonb_build_object(
    'whatsapp_count', v_wpp_count,
    'confirmacao_count', v_conf_count,
    'propostas_count', v_prop_count,
    'custom_count', v_custom_count
  );
END;
$$;

-- ============================================================================
-- 6. Compat views
-- ============================================================================

CREATE OR REPLACE VIEW public.pipe_whatsapp_compat AS
SELECT
  pe.id,
  pe.lead_id,
  pe.organization_id,
  pe.stage_key AS status,
  pe.assigned_to AS sdr_id,
  pe.assigned_to AS responsible_id,
  (pe.metadata->>'scheduled_date')::TIMESTAMPTZ AS scheduled_date,
  pe.notes,
  pe.created_at,
  pe.updated_at,
  pe.stage_changed_at AS stage_entered_at
FROM public.pipeline_entries pe
JOIN public.pipelines p ON p.id = pe.pipeline_id
WHERE p.slug = 'whatsapp' AND p.type = 'system';

CREATE OR REPLACE VIEW public.pipe_confirmacao_compat AS
SELECT
  pe.id,
  pe.lead_id,
  pe.organization_id,
  pe.stage_key AS status,
  pe.assigned_to AS sdr_id,
  pe.assigned_to AS closer_id,
  pe.assigned_to AS responsible_id,
  (pe.metadata->>'meeting_date')::TIMESTAMPTZ AS meeting_date,
  pe.metadata->>'meet_link' AS meet_link,
  (pe.metadata->>'is_confirmed')::BOOLEAN AS is_confirmed,
  pe.notes,
  pe.created_at,
  pe.updated_at,
  (pe.metadata->>'metrics_period_at')::TIMESTAMPTZ AS metrics_period_at,
  pe.stage_changed_at AS stage_entered_at
FROM public.pipeline_entries pe
JOIN public.pipelines p ON p.id = pe.pipeline_id
WHERE p.slug = 'confirmacao' AND p.type = 'system';

CREATE OR REPLACE VIEW public.pipe_propostas_compat AS
SELECT
  pe.id,
  pe.lead_id,
  pe.organization_id,
  pe.stage_key AS status,
  pe.assigned_to AS closer_id,
  pe.assigned_to AS responsible_id,
  (pe.metadata->>'sale_value')::DECIMAL AS sale_value,
  pe.metadata->>'product_type' AS product_type,
  (pe.metadata->>'calor')::INTEGER AS calor,
  pe.closed_at,
  pe.notes,
  (pe.metadata->>'commitment_date')::TIMESTAMPTZ AS commitment_date,
  (pe.metadata->>'contract_duration')::INTEGER AS contract_duration,
  pe.created_at,
  pe.updated_at,
  (pe.metadata->>'metrics_period_at')::TIMESTAMPTZ AS metrics_period_at,
  (pe.metadata->>'loss_reason_id')::UUID AS loss_reason_id,
  pe.stage_changed_at AS stage_entered_at
FROM public.pipeline_entries pe
JOIN public.pipelines p ON p.id = pe.pipeline_id
WHERE p.slug = 'propostas' AND p.type = 'system';

-- ============================================================================
-- 7. stage_changed_at trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_pipeline_entry_stage_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.stage_key IS DISTINCT FROM NEW.stage_key THEN
    NEW.stage_changed_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pipeline_entry_stage_changed
  BEFORE UPDATE ON public.pipeline_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_pipeline_entry_stage_changed();

-- ============================================================================
-- 8. GRANTs
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipelines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_entries TO authenticated;
GRANT EXECUTE ON FUNCTION public.migrate_pipe_entries(INT) TO authenticated;

-- ============================================================================
-- 9. Realtime
-- ============================================================================

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE pipelines; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE pipeline_entries; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
