-- =============================================================================
-- Migration: Order approval workflow
-- Adds approval_status lifecycle to upsell_orders, updates trigger and cohort view
-- =============================================================================

-- 1. Add approval columns to upsell_orders
ALTER TABLE upsell_orders
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_comment TEXT;

-- 2. Backfill existing orders as approved
UPDATE upsell_orders
SET approval_status = 'approved',
    approved_at = created_at
WHERE approval_status = 'pending';

-- 3. Partial index for pending queue performance
CREATE INDEX IF NOT EXISTS idx_upsell_orders_approval
  ON upsell_orders(organization_id, approval_status)
  WHERE approval_status = 'pending';

-- 4. Update auto-move trigger to fire on approval, not just insert
CREATE OR REPLACE FUNCTION handle_upsell_order_auto_move()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_org_id UUID;
  v_target_stage TEXT;
BEGIN
  -- On INSERT: only run for orders already approved (backcompat with direct approved inserts)
  -- On UPDATE: only run when approval_status transitions TO 'approved'
  IF TG_OP = 'INSERT' THEN
    IF NEW.approval_status <> 'approved' THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.approval_status <> 'approved' OR OLD.approval_status = 'approved' THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT organization_id INTO v_org_id FROM upsell_clients WHERE id = NEW.client_id;
  IF v_org_id IS NULL THEN RETURN NEW; END IF;

  SELECT stage_key INTO v_target_stage
  FROM pipeline_stages
  WHERE organization_id = v_org_id AND pipeline_type = 'upsell_base'
    AND is_active = true AND auto_move_min_days IS NOT NULL AND auto_move_max_days IS NOT NULL
    AND 0 >= auto_move_min_days AND 0 <= auto_move_max_days
  ORDER BY position ASC LIMIT 1;

  IF v_target_stage IS NOT NULL THEN
    UPDATE upsell_clients SET tipo_cliente_tempo = v_target_stage, updated_at = NOW()
    WHERE id = NEW.client_id AND tipo_cliente_tempo IS DISTINCT FROM v_target_stage;
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_upsell_order_auto_move ON upsell_orders;
CREATE TRIGGER trg_upsell_order_auto_move
  AFTER INSERT OR UPDATE OF approval_status ON upsell_orders
  FOR EACH ROW
  EXECUTE FUNCTION handle_upsell_order_auto_move();

-- 5. Recreate portfolio_retention_cohorts view — only count approved orders
CREATE OR REPLACE VIEW portfolio_retention_cohorts AS
WITH cohort_base AS (
  SELECT
    c.id AS client_id,
    c.organization_id,
    c.closer_id,
    c.segment,
    date_trunc('month', c.first_sale_at) AS cohort_month,
    c.first_sale_at
  FROM upsell_clients c
  WHERE c.is_active = true
    AND c.first_sale_at IS NOT NULL
),
months AS (
  SELECT generate_series(0, 11) AS month_offset
),
cohort_orders AS (
  SELECT
    cb.client_id,
    cb.organization_id,
    cb.cohort_month,
    cb.closer_id,
    cb.segment,
    m.month_offset,
    EXISTS (
      SELECT 1 FROM upsell_orders o
      WHERE o.client_id = cb.client_id
        AND date_trunc('month', o.sold_at) = cb.cohort_month + (m.month_offset || ' months')::interval
        AND o.approval_status = 'approved'
    ) AS had_order
  FROM cohort_base cb
  CROSS JOIN months m
  WHERE cb.cohort_month + (m.month_offset || ' months')::interval <= date_trunc('month', now())
)
SELECT
  organization_id,
  cohort_month,
  closer_id,
  segment,
  month_offset,
  COUNT(DISTINCT client_id) FILTER (WHERE had_order) AS active_clients,
  COUNT(DISTINCT client_id) AS total_clients,
  ROUND(
    COUNT(DISTINCT client_id) FILTER (WHERE had_order)::numeric
    / NULLIF(COUNT(DISTINCT client_id), 0) * 100
  ) AS retention_pct
FROM cohort_orders
GROUP BY organization_id, cohort_month, closer_id, segment, month_offset;
