-- =============================================
-- Migration: Fix defaults + add upsell_gestao support
-- =============================================

-- 1. Fix default tipo_cliente_tempo: 'novo' → '0-3m'
ALTER TABLE upsell_clients
  ALTER COLUMN tipo_cliente_tempo SET DEFAULT '0-3m';

UPDATE upsell_clients
SET tipo_cliente_tempo = '0-3m'
WHERE tipo_cliente_tempo = 'novo';

-- 2. Update pipeline_stages CHECK to include upsell_gestao
ALTER TABLE pipeline_stages DROP CONSTRAINT IF EXISTS pipeline_stages_pipeline_type_check;
ALTER TABLE pipeline_stages ADD CONSTRAINT pipeline_stages_pipeline_type_check
  CHECK (pipeline_type IN ('whatsapp', 'confirmacao', 'propostas', 'upsell_base', 'upsell_gestao'));

-- 3. Insert default gestao stages for existing organizations
DO $$
DECLARE
  org RECORD;
BEGIN
  FOR org IN SELECT id FROM organizations LOOP
    INSERT INTO pipeline_stages (organization_id, pipeline_type, stage_key, name, color, position, is_final_positive, is_final_negative) VALUES
      (org.id, 'upsell_gestao', 'campeoes',        'Campeões',        '#22C55E', 0, false, false),
      (org.id, 'upsell_gestao', 'fieis',            'Fiéis',           '#3B82F6', 1, false, false),
      (org.id, 'upsell_gestao', 'primeira_compra',  'Primeira Compra', '#8B5CF6', 2, false, false),
      (org.id, 'upsell_gestao', 'em_risco',         'Em Risco',        '#F59E0B', 3, false, false),
      (org.id, 'upsell_gestao', 'inativos',         'Inativos',        '#EF4444', 4, false, false)
    ON CONFLICT (organization_id, pipeline_type, stage_key) DO NOTHING;
  END LOOP;
END $$;

-- 4. Update create_default_pipeline_stages function to include upsell_gestao
CREATE OR REPLACE FUNCTION create_default_pipeline_stages(org_id UUID)
RETURNS void AS $$
BEGIN
  -- Etapas do Pipeline WhatsApp/Qualificacao
  INSERT INTO pipeline_stages (organization_id, pipeline_type, stage_key, name, color, position, is_final_positive) VALUES
    (org_id, 'whatsapp', 'novo', 'Novo', '#6366f1', 0, false),
    (org_id, 'whatsapp', 'abordado', 'Abordado', '#f59e0b', 1, false),
    (org_id, 'whatsapp', 'respondeu', 'Respondeu', '#3b82f6', 2, false),
    (org_id, 'whatsapp', 'esfriou', 'Esfriou', '#ef4444', 3, false),
    (org_id, 'whatsapp', 'agendado', 'Agendado', '#22c55e', 4, true)
  ON CONFLICT (organization_id, pipeline_type, stage_key) DO NOTHING;

  -- Etapas do Pipeline Confirmacao
  INSERT INTO pipeline_stages (organization_id, pipeline_type, stage_key, name, color, position, is_final_positive, is_final_negative) VALUES
    (org_id, 'confirmacao', 'reuniao_marcada', 'Reuniao Marcada', '#6366f1', 0, false, false),
    (org_id, 'confirmacao', 'confirmar_d5', 'Confirmar D-5', '#8b5cf6', 1, false, false),
    (org_id, 'confirmacao', 'confirmar_d3', 'Confirmar D-3', '#a855f7', 2, false, false),
    (org_id, 'confirmacao', 'confirmar_d2', 'Confirmar D-2', '#f59e0b', 3, false, false),
    (org_id, 'confirmacao', 'confirmar_d1', 'Confirmar D-1', '#f97316', 4, false, false),
    (org_id, 'confirmacao', 'confirmacao_no_dia', 'Confirmacao no Dia', '#ef4444', 5, false, false),
    (org_id, 'confirmacao', 'remarcar', 'Remarcar', '#f97316', 6, false, false),
    (org_id, 'confirmacao', 'compareceu', 'Compareceu', '#22c55e', 7, true, false),
    (org_id, 'confirmacao', 'perdido', 'Perdido', '#ef4444', 8, false, true)
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

-- 5. Updated trigger: recalculate BOTH tipo_cliente_tempo AND gestao_stage
CREATE OR REPLACE FUNCTION handle_upsell_order_auto_move()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id UUID;
  v_target_base TEXT;
  v_target_gestao TEXT;
BEGIN
  -- Get organization_id from the client
  SELECT organization_id INTO v_org_id
  FROM upsell_clients
  WHERE id = NEW.client_id;

  IF v_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Find the upsell_base stage where 0 days fits (just sold = 0 days ago)
  SELECT stage_key INTO v_target_base
  FROM pipeline_stages
  WHERE organization_id = v_org_id
    AND pipeline_type = 'upsell_base'
    AND is_active = true
    AND auto_move_min_days IS NOT NULL
    AND auto_move_max_days IS NOT NULL
    AND 0 >= auto_move_min_days
    AND 0 <= auto_move_max_days
  ORDER BY position ASC
  LIMIT 1;

  -- Find the upsell_gestao stage where 0 days fits
  SELECT stage_key INTO v_target_gestao
  FROM pipeline_stages
  WHERE organization_id = v_org_id
    AND pipeline_type = 'upsell_gestao'
    AND is_active = true
    AND auto_move_min_days IS NOT NULL
    AND auto_move_max_days IS NOT NULL
    AND 0 >= auto_move_min_days
    AND 0 <= auto_move_max_days
  ORDER BY position ASC
  LIMIT 1;

  -- Apply updates (only fields that have a matching rule)
  IF v_target_base IS NOT NULL OR v_target_gestao IS NOT NULL THEN
    UPDATE upsell_clients
    SET
      tipo_cliente_tempo = COALESCE(v_target_base, tipo_cliente_tempo),
      gestao_stage = COALESCE(v_target_gestao, gestao_stage),
      updated_at = NOW()
    WHERE id = NEW.client_id
      AND (
        (v_target_base IS NOT NULL AND tipo_cliente_tempo IS DISTINCT FROM v_target_base)
        OR
        (v_target_gestao IS NOT NULL AND gestao_stage IS DISTINCT FROM v_target_gestao)
      );
  END IF;

  RETURN NEW;
END;
$$;

-- Recreate the trigger
DROP TRIGGER IF EXISTS trg_upsell_order_auto_move ON upsell_orders;
CREATE TRIGGER trg_upsell_order_auto_move
  AFTER INSERT ON upsell_orders
  FOR EACH ROW
  EXECUTE FUNCTION handle_upsell_order_auto_move();
