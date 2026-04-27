-- (Re)assign products without organization to Milennials org.
-- Use this if the first assign migration ran before org matching was fixed,
-- or if products were left without organization_id (invisible to all after RLS).

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
