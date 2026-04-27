-- Add 'unitario' to the product_type enum
ALTER TYPE public.product_type ADD VALUE IF NOT EXISTS 'unitario';

-- Update the products table type column to accept the new value
-- (The type column in products is TEXT, so it already accepts any value,
-- but let's ensure consistency with a comment)
COMMENT ON COLUMN public.products.type IS 'Product type: mrr, projeto, or unitario';