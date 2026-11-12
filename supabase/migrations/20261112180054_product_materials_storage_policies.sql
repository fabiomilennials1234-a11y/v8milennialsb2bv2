-- ProductMaterialsSection uploads to <organization>/<product>/<filename>.
-- The private bucket existed without an allowing storage.objects policy,
-- so valid PDFs and images were rejected before product_materials INSERT.
-- Reuse the existing organization/master access model and require the product
-- to belong to the organization in the path. No public access or UPDATE/upsert.

CREATE POLICY product_materials_storage_insert
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'product-materials'
  AND cardinality(string_to_array(name, '/')) = 3
  AND split_part(name, '/', 3) <> ''
  AND EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id::text = split_part(objects.name, '/', 2)
      AND p.organization_id::text = split_part(objects.name, '/', 1)
      AND (
        p.organization_id IN (SELECT public.get_my_organization_ids())
        OR (SELECT public.is_master_user())
      )
  )
);

CREATE POLICY product_materials_storage_select
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'product-materials'
  AND cardinality(string_to_array(name, '/')) = 3
  AND split_part(name, '/', 3) <> ''
  AND EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id::text = split_part(objects.name, '/', 2)
      AND p.organization_id::text = split_part(objects.name, '/', 1)
      AND (
        p.organization_id IN (SELECT public.get_my_organization_ids())
        OR (SELECT public.is_master_user())
      )
  )
);

CREATE POLICY product_materials_storage_delete
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'product-materials'
  AND cardinality(string_to_array(name, '/')) = 3
  AND split_part(name, '/', 3) <> ''
  AND EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id::text = split_part(objects.name, '/', 2)
      AND p.organization_id::text = split_part(objects.name, '/', 1)
      AND (
        p.organization_id IN (SELECT public.get_my_organization_ids())
        OR (SELECT public.is_master_user())
      )
  )
);
