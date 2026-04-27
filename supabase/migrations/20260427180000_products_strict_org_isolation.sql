-- Hardening: garantir isolamento estrito de products por org.
--
-- Bug reportado: produtos da org Milennials (6030520a-2ca7-477d-be89-55758e2cd808)
-- estão visíveis em outras orgs. Investigação mostrou que:
--   - Frontend filtra `.eq("organization_id", organizationId)` corretamente
--   - Migration 20260224000000 estabeleceu products_select_own_org correto
--   - Master policies (master_select_all_products + master_all_products) permitem
--     SELECT/ALL pra qualquer master
--
-- Hipótese: alguma rota/componente legacy faz `from("products").select("*")` sem
-- filtro org, confiando na RLS. Pra masters, RLS retorna TUDO. Pra usuários
-- normais, RLS retorna só sua org. Mas se mesmo um master pode ver todos os
-- produtos da Milennials num dropdown que outras orgs também usam, pode causar
-- vazamento visual em screenshots compartilhados etc.
--
-- Defesa em profundidade: dropar master policies permissivas. Master que precisa
-- ver produtos de outra org tem que setar org via OrgSwitcher (que aciona
-- buildVirtualTeamMember + RLS por team_members).
--
-- Side effect aceitável: views master/* não terão acesso direto cross-org via
-- query simples — precisam selecionar org. Hoje não há nenhuma master view
-- listando produtos cross-org no codebase.

-- 1. Drop master permissive policies for products
DROP POLICY IF EXISTS "master_select_all_products" ON public.products;
DROP POLICY IF EXISTS "master_all_products" ON public.products;

-- 2. Drop legacy permissive policies (caso ainda existam)
DROP POLICY IF EXISTS "Products visíveis para autenticados" ON public.products;
DROP POLICY IF EXISTS "Apenas admins podem gerenciar products" ON public.products;

-- 3. Garantir que policies org-scoped estão presentes (idempotente)
DROP POLICY IF EXISTS "products_select_own_org" ON public.products;
CREATE POLICY "products_select_own_org"
ON public.products FOR SELECT
USING (
  organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "products_insert_own_org" ON public.products;
CREATE POLICY "products_insert_own_org"
ON public.products FOR INSERT
WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "products_update_own_org" ON public.products;
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

DROP POLICY IF EXISTS "products_delete_own_org" ON public.products;
CREATE POLICY "products_delete_own_org"
ON public.products FOR DELETE
USING (
  organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  )
);

-- 4. Idempotente em product_variants — herda da products via FK + RLS própria
DROP POLICY IF EXISTS "master_select_all_product_variants" ON public.product_variants;
DROP POLICY IF EXISTS "master_all_product_variants" ON public.product_variants;

-- 5. Idempotente em product_materials — herda da products via FK + RLS própria
DROP POLICY IF EXISTS "master_select_all_product_materials" ON public.product_materials;
DROP POLICY IF EXISTS "master_all_product_materials" ON public.product_materials;

-- 6. Comentário pra rastreabilidade
COMMENT ON POLICY "products_select_own_org" ON public.products IS
  'STRICT: Users see only products of organizations they have active team_member in. Master users included — must select org via OrgSwitcher to see products of other orgs (no cross-org SELECT bypass).';
COMMENT ON POLICY "products_insert_own_org" ON public.products IS
  'STRICT: Cannot insert products in orgs user is not member of.';
COMMENT ON POLICY "products_update_own_org" ON public.products IS
  'STRICT: Cannot update products of orgs user is not member of.';
COMMENT ON POLICY "products_delete_own_org" ON public.products IS
  'STRICT: Cannot delete products of orgs user is not member of.';
