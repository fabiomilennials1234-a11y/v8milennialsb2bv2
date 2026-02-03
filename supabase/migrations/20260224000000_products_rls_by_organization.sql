-- Products: isolate by organization so each org sees only its own products.
-- Masters keep seeing all (existing master_select_all_products / master_all_products).
-- Drop old policies that allowed any team member to see all products and any admin to manage all.

DROP POLICY IF EXISTS "Products visíveis para autenticados" ON public.products;
DROP POLICY IF EXISTS "Apenas admins podem gerenciar products" ON public.products;

-- SELECT: only rows whose organization_id is one of the user's organizations
CREATE POLICY "products_select_own_org"
ON public.products FOR SELECT
USING (
  organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  )
);

-- INSERT: only allow inserting with organization_id in user's organizations
CREATE POLICY "products_insert_own_org"
ON public.products FOR INSERT
WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  )
);

-- UPDATE: only rows in user's orgs; cannot change organization_id to another org
CREATE POLICY "products_update_own_org"
ON public.products FOR UPDATE
USING (
  organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  )
)
WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  )
);

-- DELETE: only rows in user's orgs
CREATE POLICY "products_delete_own_org"
ON public.products FOR DELETE
USING (
  organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  )
);

COMMENT ON POLICY "products_select_own_org" ON public.products IS
  'Users see only products of their organization(s). Masters see all via master_select_all_products.';
COMMENT ON POLICY "products_insert_own_org" ON public.products IS
  'Users can only create products for their organization(s).';
COMMENT ON POLICY "products_update_own_org" ON public.products IS
  'Users can only update products of their organization(s).';
COMMENT ON POLICY "products_delete_own_org" ON public.products IS
  'Users can only delete products of their organization(s).';
