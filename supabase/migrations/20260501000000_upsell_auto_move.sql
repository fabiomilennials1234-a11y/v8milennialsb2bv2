-- =============================================
-- Migration: Auto-move columns + trigger for upsell_base stages
-- =============================================

-- Add auto-move rule columns to pipeline_stages
ALTER TABLE pipeline_stages
  ADD COLUMN IF NOT EXISTS auto_move_min_days INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS auto_move_max_days INTEGER DEFAULT NULL;

-- Trigger function: after inserting a new upsell_order, recalculate client stage
CREATE OR REPLACE FUNCTION handle_upsell_order_auto_move()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id UUID;
  v_target_stage TEXT;
BEGIN
  -- Get organization_id from the client
  SELECT organization_id INTO v_org_id
  FROM upsell_clients
  WHERE id = NEW.client_id;

  IF v_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Find the stage where 0 days fits (just sold = 0 days ago)
  SELECT stage_key INTO v_target_stage
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

  IF v_target_stage IS NOT NULL THEN
    UPDATE upsell_clients
    SET tipo_cliente_tempo = v_target_stage,
        updated_at = NOW()
    WHERE id = NEW.client_id
      AND tipo_cliente_tempo IS DISTINCT FROM v_target_stage;
  END IF;

  RETURN NEW;
END;
$$;

-- Create the trigger
DROP TRIGGER IF EXISTS trg_upsell_order_auto_move ON upsell_orders;
CREATE TRIGGER trg_upsell_order_auto_move
  AFTER INSERT ON upsell_orders
  FOR EACH ROW
  EXECUTE FUNCTION handle_upsell_order_auto_move();
