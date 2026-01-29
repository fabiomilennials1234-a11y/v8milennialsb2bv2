-- Drop the old check constraint
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_type_check;

-- Add updated check constraint that includes 'unitario'
ALTER TABLE public.products ADD CONSTRAINT products_type_check 
CHECK (type IN ('mrr', 'projeto', 'unitario'));