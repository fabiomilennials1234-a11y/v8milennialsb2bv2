-- Criar tabela de etapas customizáveis para pipelines
-- Esta tabela permite que cada organização customize as etapas dos funis

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  pipeline_type TEXT NOT NULL CHECK (pipeline_type IN ('whatsapp', 'confirmacao', 'propostas')),
  stage_key TEXT NOT NULL, -- Identificador único da etapa (usado internamente)
  name TEXT NOT NULL, -- Nome exibido para o usuário
  color TEXT DEFAULT '#64748b',
  position INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  is_final_positive BOOLEAN DEFAULT false, -- Ex: "Vendido", "Compareceu", "Agendado"
  is_final_negative BOOLEAN DEFAULT false, -- Ex: "Perdido"
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Cada organização pode ter apenas uma etapa com o mesmo key por pipeline
  UNIQUE(organization_id, pipeline_type, stage_key)
);

-- Índices para performance
CREATE INDEX idx_pipeline_stages_org ON pipeline_stages(organization_id);
CREATE INDEX idx_pipeline_stages_type ON pipeline_stages(organization_id, pipeline_type);

-- RLS
ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view pipeline stages of their organization"
ON pipeline_stages FOR SELECT
USING (
  organization_id IN (
    SELECT organization_id FROM team_members WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can manage pipeline stages of their organization"
ON pipeline_stages FOR ALL
USING (
  organization_id IN (
    SELECT organization_id FROM team_members WHERE user_id = auth.uid()
  )
);

-- Função para criar etapas padrão para uma nova organização
CREATE OR REPLACE FUNCTION create_default_pipeline_stages(org_id UUID)
RETURNS void AS $$
BEGIN
  -- Etapas do Pipeline WhatsApp/Qualificação
  INSERT INTO pipeline_stages (organization_id, pipeline_type, stage_key, name, color, position, is_final_positive) VALUES
    (org_id, 'whatsapp', 'novo', 'Novo', '#6366f1', 0, false),
    (org_id, 'whatsapp', 'abordado', 'Abordado', '#f59e0b', 1, false),
    (org_id, 'whatsapp', 'respondeu', 'Respondeu', '#3b82f6', 2, false),
    (org_id, 'whatsapp', 'esfriou', 'Esfriou', '#ef4444', 3, false),
    (org_id, 'whatsapp', 'agendado', 'Agendado ✓', '#22c55e', 4, true)
  ON CONFLICT (organization_id, pipeline_type, stage_key) DO NOTHING;

  -- Etapas do Pipeline Confirmação
  INSERT INTO pipeline_stages (organization_id, pipeline_type, stage_key, name, color, position, is_final_positive, is_final_negative) VALUES
    (org_id, 'confirmacao', 'reuniao_marcada', 'Reunião Marcada', '#6366f1', 0, false, false),
    (org_id, 'confirmacao', 'confirmar_d5', 'Confirmar D-5', '#8b5cf6', 1, false, false),
    (org_id, 'confirmacao', 'confirmar_d3', 'Confirmar D-3', '#a855f7', 2, false, false),
    (org_id, 'confirmacao', 'confirmar_d2', 'Confirmar D-2', '#f59e0b', 3, false, false),
    (org_id, 'confirmacao', 'confirmar_d1', 'Confirmar D-1', '#f97316', 4, false, false),
    (org_id, 'confirmacao', 'confirmacao_no_dia', 'Confirmação no Dia', '#ef4444', 5, false, false),
    (org_id, 'confirmacao', 'remarcar', 'Remarcar 📅', '#f97316', 6, false, false),
    (org_id, 'confirmacao', 'compareceu', 'Compareceu ✓', '#22c55e', 7, true, false),
    (org_id, 'confirmacao', 'perdido', 'Perdido ✗', '#ef4444', 8, false, true)
  ON CONFLICT (organization_id, pipeline_type, stage_key) DO NOTHING;

  -- Etapas do Pipeline Propostas
  INSERT INTO pipeline_stages (organization_id, pipeline_type, stage_key, name, color, position, is_final_positive, is_final_negative) VALUES
    (org_id, 'propostas', 'marcar_compromisso', 'Marcar Compromisso', '#F5C518', 0, false, false),
    (org_id, 'propostas', 'reativar', 'Reativar', '#F97316', 1, false, false),
    (org_id, 'propostas', 'compromisso_marcado', 'Compromisso Marcado', '#3B82F6', 2, false, false),
    (org_id, 'propostas', 'esfriou', 'Esfriou', '#64748B', 3, false, false),
    (org_id, 'propostas', 'futuro', 'Futuro', '#8B5CF6', 4, false, false),
    (org_id, 'propostas', 'vendido', 'Vendido ✓', '#22C55E', 5, true, false),
    (org_id, 'propostas', 'perdido', 'Perdido', '#EF4444', 6, false, true)
  ON CONFLICT (organization_id, pipeline_type, stage_key) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Criar etapas padrão para todas as organizações existentes
DO $$
DECLARE
  org RECORD;
BEGIN
  FOR org IN SELECT id FROM organizations LOOP
    PERFORM create_default_pipeline_stages(org.id);
  END LOOP;
END $$;

-- Trigger para criar etapas padrão quando uma nova organização é criada
CREATE OR REPLACE FUNCTION trigger_create_default_stages()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM create_default_pipeline_stages(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_organization_created_stages ON organizations;
CREATE TRIGGER on_organization_created_stages
AFTER INSERT ON organizations
FOR EACH ROW
EXECUTE FUNCTION trigger_create_default_stages();

-- Habilitar Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE pipeline_stages;
