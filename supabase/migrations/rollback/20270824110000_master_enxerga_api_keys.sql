-- Rollback: volta o SELECT sem master (master deixa de ver chaves de qualquer org).
DROP POLICY IF EXISTS "Org members can view own org api_keys" ON public.api_keys;
CREATE POLICY "Org members can view own org api_keys"
  ON public.api_keys FOR SELECT
  USING (organization_id IN (SELECT public.get_my_organization_ids()));
