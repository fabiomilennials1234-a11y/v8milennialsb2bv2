BEGIN;

DROP FUNCTION IF EXISTS public.check_oraculo_limit(uuid);
DROP FUNCTION IF EXISTS public.record_oraculo_usage(uuid, uuid, text, text);

ALTER TABLE public.oraculo_usage RENAME TO oraculo_legacy_usage_archive;
ALTER TABLE public.oraculo_legacy_usage_archive
  RENAME CONSTRAINT oraculo_usage_pkey TO oraculo_legacy_usage_archive_pkey;
ALTER TABLE public.oraculo_legacy_usage_archive
  RENAME CONSTRAINT oraculo_usage_organization_id_fkey TO oraculo_legacy_usage_archive_org_fkey;
ALTER TABLE public.oraculo_legacy_usage_archive
  RENAME CONSTRAINT oraculo_usage_user_id_fkey TO oraculo_legacy_usage_archive_user_fkey;
ALTER INDEX public.idx_oraculo_usage_user_date RENAME TO idx_oraculo_legacy_usage_archive_user_date;
ALTER INDEX public.idx_oraculo_usage_org RENAME TO idx_oraculo_legacy_usage_archive_org;

DROP POLICY IF EXISTS "Users can view own oraculo usage" ON public.oraculo_legacy_usage_archive;
DROP POLICY IF EXISTS "Users can insert own oraculo usage" ON public.oraculo_legacy_usage_archive;
DROP POLICY IF EXISTS "master_ghost_all_oraculo_usage" ON public.oraculo_legacy_usage_archive;
DROP POLICY IF EXISTS "master_ghost_select_oraculo_usage" ON public.oraculo_legacy_usage_archive;

REVOKE ALL ON TABLE public.oraculo_legacy_usage_archive FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.oraculo_legacy_usage_archive TO service_role;

DO $block$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_readonly') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.oraculo_legacy_usage_archive FROM mcp_readonly';
  END IF;
END
$block$;

COMMENT ON TABLE public.oraculo_legacy_usage_archive IS
  'Arquivo somente leitura do chat Oráculo substituído pelo SCRUM-606. Não usar para quota ou produto.';

COMMIT;
