-- Add configurable default reorder cycle days per organization
-- Used by calculate-portfolio-health when client has < 2 orders

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS default_reorder_cycle_days INTEGER;

COMMENT ON COLUMN organizations.default_reorder_cycle_days
  IS 'Default reorder cycle in days for new clients with < 2 orders. NULL = system default (30d).';
