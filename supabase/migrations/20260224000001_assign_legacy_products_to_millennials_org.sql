-- Assign all products that currently have no organization (visible to everyone)
-- to the Millennials/Milennials organization, so only that org sees them.

UPDATE public.products
SET organization_id = (
  SELECT id FROM public.organizations
  WHERE (name ILIKE '%millennial%' OR name ILIKE '%milennial%'
         OR slug ILIKE '%millennial%' OR slug ILIKE '%milennial%')
  LIMIT 1
)
WHERE organization_id IS NULL
  AND EXISTS (
    SELECT 1 FROM public.organizations
    WHERE (name ILIKE '%millennial%' OR name ILIKE '%milennial%'
           OR slug ILIKE '%millennial%' OR slug ILIKE '%milennial%')
    LIMIT 1
  );

COMMENT ON TABLE public.products IS 'Products are scoped by organization_id; legacy rows were assigned to the Millennials org.';
