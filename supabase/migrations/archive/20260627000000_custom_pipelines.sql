-- ============================================
-- CUSTOM PIPELINES: Funis customizáveis pelo usuário
-- ============================================
-- Data: 2026-02-27
-- Permite que organizações criem funis personalizados além dos 5 padrão.
-- Tabelas: custom_pipelines, custom_pipeline_stages, custom_pipe_entries, custom_pipe_transitions
-- ============================================

-- ────────────────────────────────────────────────────────────
-- 1. Tabela: custom_pipelines (registro dos funis)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.custom_pipelines (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  slug             TEXT NOT NULL,
  description      TEXT,
  icon             TEXT DEFAULT 'kanban',
  color            TEXT DEFAULT '#3b82f6',
  position         INTEGER DEFAULT 0,
  is_active        BOOLEAN DEFAULT true,
  created_by       UUID REFERENCES public.profiles(id),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_custom_pipelines_org
  ON public.custom_pipelines(organization_id);

CREATE INDEX IF NOT EXISTS idx_custom_pipelines_active
  ON public.custom_pipelines(organization_id, is_active);

-- ────────────────────────────────────────────────────────────
-- 2. Tabela: custom_pipeline_stages (etapas dos funis)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.custom_pipeline_stages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pipeline_id       UUID NOT NULL REFERENCES public.custom_pipelines(id) ON DELETE CASCADE,
  stage_key         TEXT NOT NULL,
  name              TEXT NOT NULL,
  color             TEXT DEFAULT '#64748b',
  position          INTEGER DEFAULT 0,
  is_active         BOOLEAN DEFAULT true,
  is_final_positive BOOLEAN DEFAULT false,
  is_final_negative BOOLEAN DEFAULT false,
  -- Transição automática para outro funil customizado
  target_pipeline_id UUID REFERENCES public.custom_pipelines(id) ON DELETE SET NULL,
  target_stage_id    UUID REFERENCES public.custom_pipeline_stages(id) ON DELETE SET NULL,
  -- Transição automática para funil padrão
  target_pipe_type   TEXT,
  target_stage_key   TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pipeline_id, stage_key)
);

CREATE INDEX IF NOT EXISTS idx_custom_pipeline_stages_pipeline
  ON public.custom_pipeline_stages(pipeline_id);

CREATE INDEX IF NOT EXISTS idx_custom_pipeline_stages_active
  ON public.custom_pipeline_stages(pipeline_id, is_active);

-- ────────────────────────────────────────────────────────────
-- 3. Tabela: custom_pipe_entries (leads nos funis)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.custom_pipe_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pipeline_id      UUID NOT NULL REFERENCES public.custom_pipelines(id) ON DELETE CASCADE,
  lead_id          UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  stage_id         UUID NOT NULL REFERENCES public.custom_pipeline_stages(id),
  assigned_to      UUID REFERENCES public.profiles(id),
  notes            TEXT,
  entered_at       TIMESTAMPTZ DEFAULT NOW(),
  stage_changed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pipeline_id, lead_id)
);

CREATE INDEX IF NOT EXISTS idx_custom_pipe_entries_pipeline
  ON public.custom_pipe_entries(pipeline_id);

CREATE INDEX IF NOT EXISTS idx_custom_pipe_entries_lead
  ON public.custom_pipe_entries(lead_id);

CREATE INDEX IF NOT EXISTS idx_custom_pipe_entries_stage
  ON public.custom_pipe_entries(stage_id);

CREATE INDEX IF NOT EXISTS idx_custom_pipe_entries_assigned
  ON public.custom_pipe_entries(assigned_to);

-- ────────────────────────────────────────────────────────────
-- 4. Tabela: custom_pipe_transitions (regras de transição)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.custom_pipe_transitions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Origem: funil customizado OU padrão
  source_pipeline_id  UUID REFERENCES public.custom_pipelines(id) ON DELETE CASCADE,
  source_stage_id     UUID REFERENCES public.custom_pipeline_stages(id) ON DELETE CASCADE,
  source_pipe_type    TEXT,
  source_stage_key    TEXT,
  -- Destino: funil customizado OU padrão
  target_pipeline_id  UUID REFERENCES public.custom_pipelines(id) ON DELETE CASCADE,
  target_stage_id     UUID REFERENCES public.custom_pipeline_stages(id) ON DELETE CASCADE,
  target_pipe_type    TEXT,
  target_stage_key    TEXT,
  is_active           BOOLEAN DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  -- Constraint: origem deve ser custom OU padrão, não ambos
  CONSTRAINT chk_source CHECK (
    (source_pipeline_id IS NOT NULL AND source_pipe_type IS NULL) OR
    (source_pipeline_id IS NULL AND source_pipe_type IS NOT NULL)
  ),
  -- Constraint: destino deve ser custom OU padrão, não ambos
  CONSTRAINT chk_target CHECK (
    (target_pipeline_id IS NOT NULL AND target_pipe_type IS NULL) OR
    (target_pipeline_id IS NULL AND target_pipe_type IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_custom_pipe_transitions_org
  ON public.custom_pipe_transitions(organization_id);

CREATE INDEX IF NOT EXISTS idx_custom_pipe_transitions_source
  ON public.custom_pipe_transitions(source_pipeline_id, source_stage_id);

-- ────────────────────────────────────────────────────────────
-- 5. RLS Policies (Row Level Security)
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.custom_pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_pipe_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_pipe_transitions ENABLE ROW LEVEL SECURITY;

-- custom_pipelines
CREATE POLICY "Users can view their org pipelines"
  ON public.custom_pipelines FOR SELECT
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "Users can manage their org pipelines"
  ON public.custom_pipelines FOR ALL
  USING (organization_id = public.get_user_organization_id())
  WITH CHECK (organization_id = public.get_user_organization_id());

-- custom_pipeline_stages
CREATE POLICY "Users can view their org pipeline stages"
  ON public.custom_pipeline_stages FOR SELECT
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "Users can manage their org pipeline stages"
  ON public.custom_pipeline_stages FOR ALL
  USING (organization_id = public.get_user_organization_id())
  WITH CHECK (organization_id = public.get_user_organization_id());

-- custom_pipe_entries
CREATE POLICY "Users can view their org pipe entries"
  ON public.custom_pipe_entries FOR SELECT
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "Users can manage their org pipe entries"
  ON public.custom_pipe_entries FOR ALL
  USING (organization_id = public.get_user_organization_id())
  WITH CHECK (organization_id = public.get_user_organization_id());

-- custom_pipe_transitions
CREATE POLICY "Users can view their org pipe transitions"
  ON public.custom_pipe_transitions FOR SELECT
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "Users can manage their org pipe transitions"
  ON public.custom_pipe_transitions FOR ALL
  USING (organization_id = public.get_user_organization_id())
  WITH CHECK (organization_id = public.get_user_organization_id());

-- ────────────────────────────────────────────────────────────
-- 6. Trigger: updated_at automático
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_custom_pipelines_updated_at
  BEFORE UPDATE ON public.custom_pipelines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_custom_pipeline_stages_updated_at
  BEFORE UPDATE ON public.custom_pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_custom_pipe_entries_updated_at
  BEFORE UPDATE ON public.custom_pipe_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
