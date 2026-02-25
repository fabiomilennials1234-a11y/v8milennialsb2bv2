-- =============================================
-- Migration: Transição configurável na etapa de sucesso
-- Adiciona target_pipe_type e target_stage_key em pipeline_stages
-- para permitir que o admin configure para qual pipe/stage
-- o lead é enviado ao atingir a etapa de sucesso (is_final_positive).
-- =============================================

-- 1. Adicionar colunas
ALTER TABLE pipeline_stages
  ADD COLUMN IF NOT EXISTS target_pipe_type TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS target_stage_key TEXT DEFAULT NULL;

-- 2. Popular defaults para etapas de sucesso existentes
-- whatsapp/agendado → confirmacao/reuniao_marcada
UPDATE pipeline_stages
SET target_pipe_type = 'confirmacao', target_stage_key = 'reuniao_marcada'
WHERE pipeline_type = 'whatsapp'
  AND stage_key = 'agendado'
  AND is_final_positive = true
  AND target_pipe_type IS NULL;

-- confirmacao/compareceu → propostas/marcar_compromisso
UPDATE pipeline_stages
SET target_pipe_type = 'propostas', target_stage_key = 'marcar_compromisso'
WHERE pipeline_type = 'confirmacao'
  AND stage_key = 'compareceu'
  AND is_final_positive = true
  AND target_pipe_type IS NULL;

-- 3. Atualizar create_default_pipeline_stages para incluir target_pipe_type/target_stage_key
CREATE OR REPLACE FUNCTION create_default_pipeline_stages(org_id UUID)
RETURNS void AS $$
BEGIN
  -- Etapas do Pipeline WhatsApp/Qualificacao
  INSERT INTO pipeline_stages (organization_id, pipeline_type, stage_key, name, color, position, is_final_positive, target_pipe_type, target_stage_key) VALUES
    (org_id, 'whatsapp', 'novo', 'Novo', '#6366f1', 0, false, NULL, NULL),
    (org_id, 'whatsapp', 'abordado', 'Abordado', '#f59e0b', 1, false, NULL, NULL),
    (org_id, 'whatsapp', 'respondeu', 'Respondeu', '#3b82f6', 2, false, NULL, NULL),
    (org_id, 'whatsapp', 'esfriou', 'Esfriou', '#ef4444', 3, false, NULL, NULL),
    (org_id, 'whatsapp', 'agendado', 'Agendado', '#22c55e', 4, true, 'confirmacao', 'reuniao_marcada')
  ON CONFLICT (organization_id, pipeline_type, stage_key) DO NOTHING;

  -- Etapas do Pipeline Confirmacao
  INSERT INTO pipeline_stages (organization_id, pipeline_type, stage_key, name, color, position, is_final_positive, is_final_negative, target_pipe_type, target_stage_key) VALUES
    (org_id, 'confirmacao', 'reuniao_marcada', 'Reuniao Marcada', '#6366f1', 0, false, false, NULL, NULL),
    (org_id, 'confirmacao', 'confirmar_d5', 'Confirmar D-5', '#8b5cf6', 1, false, false, NULL, NULL),
    (org_id, 'confirmacao', 'confirmar_d3', 'Confirmar D-3', '#a855f7', 2, false, false, NULL, NULL),
    (org_id, 'confirmacao', 'confirmar_d2', 'Confirmar D-2', '#f59e0b', 3, false, false, NULL, NULL),
    (org_id, 'confirmacao', 'confirmar_d1', 'Confirmar D-1', '#f97316', 4, false, false, NULL, NULL),
    (org_id, 'confirmacao', 'confirmacao_no_dia', 'Confirmacao no Dia', '#ef4444', 5, false, false, NULL, NULL),
    (org_id, 'confirmacao', 'remarcar', 'Remarcar', '#f97316', 6, false, false, NULL, NULL),
    (org_id, 'confirmacao', 'compareceu', 'Compareceu', '#22c55e', 7, true, false, 'propostas', 'marcar_compromisso'),
    (org_id, 'confirmacao', 'perdido', 'Perdido', '#ef4444', 8, false, true, NULL, NULL)
  ON CONFLICT (organization_id, pipeline_type, stage_key) DO NOTHING;

  -- Etapas do Pipeline Propostas
  INSERT INTO pipeline_stages (organization_id, pipeline_type, stage_key, name, color, position, is_final_positive, is_final_negative) VALUES
    (org_id, 'propostas', 'marcar_compromisso', 'Marcar Compromisso', '#F5C518', 0, false, false),
    (org_id, 'propostas', 'reativar', 'Reativar', '#F97316', 1, false, false),
    (org_id, 'propostas', 'compromisso_marcado', 'Compromisso Marcado', '#3B82F6', 2, false, false),
    (org_id, 'propostas', 'esfriou', 'Esfriou', '#64748B', 3, false, false),
    (org_id, 'propostas', 'futuro', 'Futuro', '#8B5CF6', 4, false, false),
    (org_id, 'propostas', 'vendido', 'Vendido', '#22C55E', 5, true, false),
    (org_id, 'propostas', 'perdido', 'Perdido', '#EF4444', 6, false, true)
  ON CONFLICT (organization_id, pipeline_type, stage_key) DO NOTHING;

  -- Etapas do Upsell Base (colunas por tempo de contrato)
  INSERT INTO pipeline_stages (organization_id, pipeline_type, stage_key, name, color, position, is_final_positive, is_final_negative) VALUES
    (org_id, 'upsell_base', '0-3m',   '0-3 meses',   '#3B82F6', 0, false, false),
    (org_id, 'upsell_base', '3-6m',   '3-6 meses',   '#22C55E', 1, false, false),
    (org_id, 'upsell_base', '6-9m',   '6-9 meses',   '#F59E0B', 2, false, false),
    (org_id, 'upsell_base', '9-12m',  '9-12 meses',  '#EF4444', 3, false, false),
    (org_id, 'upsell_base', '12-18m', '12-18 meses', '#8B5CF6', 4, false, false),
    (org_id, 'upsell_base', '18m+',   '18+ meses',   '#EC4899', 5, false, false)
  ON CONFLICT (organization_id, pipeline_type, stage_key) DO NOTHING;

  -- Etapas do Upsell Gestao (classificacao lifecycle)
  INSERT INTO pipeline_stages (organization_id, pipeline_type, stage_key, name, color, position, is_final_positive, is_final_negative) VALUES
    (org_id, 'upsell_gestao', 'campeoes',        'Campeões',        '#22C55E', 0, false, false),
    (org_id, 'upsell_gestao', 'fieis',            'Fiéis',           '#3B82F6', 1, false, false),
    (org_id, 'upsell_gestao', 'primeira_compra',  'Primeira Compra', '#8B5CF6', 2, false, false),
    (org_id, 'upsell_gestao', 'em_risco',         'Em Risco',        '#F59E0B', 3, false, false),
    (org_id, 'upsell_gestao', 'inativos',         'Inativos',        '#EF4444', 4, false, false)
  ON CONFLICT (organization_id, pipeline_type, stage_key) DO NOTHING;
END;
$$ LANGUAGE plpgsql;
