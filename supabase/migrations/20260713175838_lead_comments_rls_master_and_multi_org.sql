-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260713175838  name: lead_comments_rls_master_and_multi_org
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- lead_comments RLS — master-ghost bypass + multi-org fix.
-- Root cause: policies usavam get_user_organization_id() (só 1ª org, sem master).
-- Espelha padrão de leads: get_my_organization_ids() (SETOF, multi-org) + is_master_user().

BEGIN;

DROP POLICY IF EXISTS "lead_comments_select_by_org" ON public.lead_comments;
CREATE POLICY "lead_comments_select_by_org"
  ON public.lead_comments FOR SELECT
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    OR (SELECT public.is_master_user())
  );

DROP POLICY IF EXISTS "lead_comments_insert_by_org" ON public.lead_comments;
CREATE POLICY "lead_comments_insert_by_org"
  ON public.lead_comments FOR INSERT
  WITH CHECK (
    author_user_id = auth.uid()
    AND (
      organization_id IN (SELECT public.get_my_organization_ids())
      OR (SELECT public.is_master_user())
    )
  );

DROP POLICY IF EXISTS "lead_comments_update_by_author_or_admin" ON public.lead_comments;
CREATE POLICY "lead_comments_update_by_author_or_admin"
  ON public.lead_comments FOR UPDATE
  USING (
    (SELECT public.is_master_user())
    OR (
      organization_id IN (SELECT public.get_my_organization_ids())
      AND (
        author_user_id = auth.uid()
        OR (SELECT public.is_user_admin())
      )
    )
  )
  WITH CHECK (
    organization_id IN (SELECT public.get_my_organization_ids())
    OR (SELECT public.is_master_user())
  );

DO $$
DECLARE v_pol int;
BEGIN
  SELECT count(*) INTO v_pol FROM pg_policies
  WHERE schemaname='public' AND tablename='lead_comments';
  IF v_pol < 3 THEN RAISE EXCEPTION 'FAIL: policies missing (%/3)', v_pol; END IF;
  RAISE NOTICE 'VALIDATION PASSED';
END$$;

COMMIT;
