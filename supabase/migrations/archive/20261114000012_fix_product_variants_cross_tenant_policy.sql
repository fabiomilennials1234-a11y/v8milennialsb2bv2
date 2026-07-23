-- 20261114000012_fix_product_variants_cross_tenant_policy.sql
--
-- INCIDENTE 2026-06-01 (sweep #5): a policy "Apenas admins podem gerenciar variações"
-- em product_variants era FOR ALL {public} USING (has_role(auth.uid(), 'admin')) —
-- has_role NÃO escopa por org → admin de uma org podia INSERT/UPDATE/DELETE variações
-- de produtos de QUALQUER outra org (write cross-tenant).
--
-- Fix: escopar à(s) org(s) onde o usuário é admin (get_my_admin_organization_ids()).
-- A leitura já era org-scoped pela policy product_variants_select_org.
-- (Aplicado out-of-band no prod durante o incidente; este é o registro versionado.)

DROP POLICY IF EXISTS "Apenas admins podem gerenciar variações" ON public.product_variants;

CREATE POLICY "product_variants_admin_manage_org" ON public.product_variants
  FOR ALL
  TO authenticated
  USING (organization_id IN (SELECT public.get_my_admin_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.get_my_admin_organization_ids()));
