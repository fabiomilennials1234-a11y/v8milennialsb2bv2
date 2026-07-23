-- Add quantity and unit_price columns to pipe_proposta_items
-- Preserves sale_value as the line total (quantity * unit_price) for backward compatibility
-- with dashboard RPCs, product ranking, and analytics that already SUM(sale_value).

ALTER TABLE public.pipe_proposta_items
  ADD COLUMN quantity integer NOT NULL DEFAULT 1,
  ADD COLUMN unit_price numeric;

-- Add check constraints
ALTER TABLE public.pipe_proposta_items
  ADD CONSTRAINT chk_quantity_positive CHECK (quantity > 0),
  ADD CONSTRAINT chk_unit_price_non_negative CHECK (unit_price >= 0),
  ADD CONSTRAINT chk_sale_value_non_negative CHECK (sale_value >= 0);

-- Backfill existing rows: quantity=1, unit_price=sale_value (single unit)
UPDATE public.pipe_proposta_items
SET unit_price = COALESCE(sale_value, 0)
WHERE unit_price IS NULL;

-- Comment for documentation
COMMENT ON COLUMN public.pipe_proposta_items.quantity IS 'Number of units. Default 1. Always > 0.';
COMMENT ON COLUMN public.pipe_proposta_items.unit_price IS 'Price per unit. sale_value = quantity * unit_price.';
COMMENT ON COLUMN public.pipe_proposta_items.sale_value IS 'Total line value (quantity * unit_price). Kept as source of truth for dashboard RPCs.';
