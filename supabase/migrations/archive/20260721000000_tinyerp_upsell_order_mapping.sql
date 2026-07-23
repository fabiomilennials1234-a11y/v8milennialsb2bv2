-- Allow tinyerp_order_mappings to reference upsell_orders as well as pipe_propostas
-- Make pipe_proposta_id nullable (upsell orders don't have one)
-- Add upsell_order_id column

ALTER TABLE tinyerp_order_mappings
  ALTER COLUMN pipe_proposta_id DROP NOT NULL;

ALTER TABLE tinyerp_order_mappings
  ADD COLUMN upsell_order_id UUID REFERENCES upsell_orders(id) ON DELETE CASCADE;

-- Drop the old unique constraint that requires pipe_proposta_id
ALTER TABLE tinyerp_order_mappings
  DROP CONSTRAINT IF EXISTS unique_proposta_tiny_order;

-- New constraint: unique per upsell order
CREATE UNIQUE INDEX IF NOT EXISTS idx_tinyerp_order_mappings_upsell
  ON tinyerp_order_mappings(upsell_order_id)
  WHERE upsell_order_id IS NOT NULL;

-- Restore uniqueness for pipe_proposta_id (nullable-safe)
CREATE UNIQUE INDEX IF NOT EXISTS idx_tinyerp_order_mappings_proposta
  ON tinyerp_order_mappings(pipe_proposta_id)
  WHERE pipe_proposta_id IS NOT NULL;

-- Ensure at least one reference is set
ALTER TABLE tinyerp_order_mappings
  ADD CONSTRAINT chk_order_ref CHECK (
    pipe_proposta_id IS NOT NULL OR upsell_order_id IS NOT NULL
  );

-- Index for upsell order lookups
CREATE INDEX IF NOT EXISTS idx_tinyerp_order_mappings_upsell_order
  ON tinyerp_order_mappings(upsell_order_id);
