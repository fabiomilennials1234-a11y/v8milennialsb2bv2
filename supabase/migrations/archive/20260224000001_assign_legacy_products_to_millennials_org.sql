-- Assign all products that have no organization (the ones that appeared to everyone
-- before RLS) to the Milennials/Millennials organization.

-- Match org by name or slug: Milennials (1 L), Millennials (2 Ls), and variants
UPDATE public.products
SET organization_id = (
  SELECT id FROM public.organizations
  WHERE (
    name ILIKE '%milennial%' OR name ILIKE '%millennial%'
    OR slug ILIKE '%milennial%' OR slug ILIKE '%millennial%'
  )
  ORDER BY created_at ASC NULLS LAST
  LIMIT 1
)
WHERE organization_id IS NULL
  AND EXISTS (
    SELECT 1 FROM public.organizations
    WHERE (
      name ILIKE '%milennial%' OR name ILIKE '%millennial%'
      OR slug ILIKE '%milennial%' OR slug ILIKE '%millennial%'
    )
    LIMIT 1
  );

COMMENT ON TABLE public.products IS 'Products are scoped by organization_id; legacy rows were assigned to the Milennials org.';
