-- =============================================
-- Migration: Gestão sync rules + manual override
-- =============================================

-- 1. Tabela de regras condicionais Base → Gestão
CREATE TABLE IF NOT EXISTS upsell_gestao_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  base_stage_key  TEXT NOT NULL,
  gestao_from_stage TEXT NOT NULL,
  gestao_to_stage TEXT NOT NULL,
  position        INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_upsell_gestao_rules_org
  ON upsell_gestao_rules(organization_id);
CREATE INDEX IF NOT EXISTS idx_upsell_gestao_rules_base_stage
  ON upsell_gestao_rules(organization_id, base_stage_key);

-- Unique constraint: uma regra por combinação org + base_stage + gestao_from
ALTER TABLE upsell_gestao_rules DROP CONSTRAINT IF EXISTS uq_gestao_rule_combo;
ALTER TABLE upsell_gestao_rules
  ADD CONSTRAINT uq_gestao_rule_combo
  UNIQUE (organization_id, base_stage_key, gestao_from_stage);

-- RLS
ALTER TABLE upsell_gestao_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "upsell_gestao_rules_select_org" ON upsell_gestao_rules;
CREATE POLICY "upsell_gestao_rules_select_org" ON upsell_gestao_rules
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_organization_id());

DROP POLICY IF EXISTS "upsell_gestao_rules_insert_org" ON upsell_gestao_rules;
CREATE POLICY "upsell_gestao_rules_insert_org" ON upsell_gestao_rules
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_organization_id());

DROP POLICY IF EXISTS "upsell_gestao_rules_update_org" ON upsell_gestao_rules;
CREATE POLICY "upsell_gestao_rules_update_org" ON upsell_gestao_rules
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_organization_id())
  WITH CHECK (organization_id = public.get_user_organization_id());

DROP POLICY IF EXISTS "upsell_gestao_rules_delete_org" ON upsell_gestao_rules;
CREATE POLICY "upsell_gestao_rules_delete_org" ON upsell_gestao_rules
  FOR DELETE TO authenticated
  USING (organization_id = public.get_user_organization_id());

-- Realtime
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE upsell_gestao_rules; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Campo de bloqueio manual no upsell_clients
ALTER TABLE upsell_clients
  ADD COLUMN IF NOT EXISTS gestao_manual_override BOOLEAN NOT NULL DEFAULT false;

-- 3. Trigger atualizado: recalcula ambos + reseta override na nova venda
CREATE OR REPLACE FUNCTION handle_upsell_order_auto_move()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id UUID;
  v_current_gestao TEXT;
  v_target_base TEXT;
  v_target_gestao TEXT;
BEGIN
  -- Get organization_id and current gestao_stage from the client
  SELECT organization_id, gestao_stage
  INTO v_org_id, v_current_gestao
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

  -- If base stage changed, look for gestao sync rule
  IF v_target_base IS NOT NULL THEN
    SELECT gestao_to_stage INTO v_target_gestao
    FROM upsell_gestao_rules
    WHERE organization_id = v_org_id
      AND base_stage_key = v_target_base
      AND gestao_from_stage = v_current_gestao
      AND is_active = true
    LIMIT 1;
  END IF;

  -- Apply updates: base stage + gestao (if rule matched) + reset override
  UPDATE upsell_clients
  SET
    tipo_cliente_tempo = COALESCE(v_target_base, tipo_cliente_tempo),
    gestao_stage = COALESCE(v_target_gestao, gestao_stage),
    gestao_manual_override = false,
    updated_at = NOW()
  WHERE id = NEW.client_id
    AND (
      (v_target_base IS NOT NULL AND tipo_cliente_tempo IS DISTINCT FROM v_target_base)
      OR (v_target_gestao IS NOT NULL AND gestao_stage IS DISTINCT FROM v_target_gestao)
      OR gestao_manual_override = true
    );

  RETURN NEW;
END;
$$;

-- Recreate the trigger
DROP TRIGGER IF EXISTS trg_upsell_order_auto_move ON upsell_orders;
CREATE TRIGGER trg_upsell_order_auto_move
  AFTER INSERT ON upsell_orders
  FOR EACH ROW
  EXECUTE FUNCTION handle_upsell_order_auto_move();

-- 4. Trigger updated_at para upsell_gestao_rules
DROP TRIGGER IF EXISTS trg_upsell_gestao_rules_updated_at ON upsell_gestao_rules;
CREATE TRIGGER trg_upsell_gestao_rules_updated_at
  BEFORE UPDATE ON upsell_gestao_rules
  FOR EACH ROW EXECUTE FUNCTION update_upsell_updated_at();
