BEGIN;

ALTER TABLE public.oraculo_legacy_usage_archive RENAME TO oraculo_usage;
ALTER TABLE public.oraculo_usage
  RENAME CONSTRAINT oraculo_legacy_usage_archive_pkey TO oraculo_usage_pkey;
ALTER TABLE public.oraculo_usage
  RENAME CONSTRAINT oraculo_legacy_usage_archive_org_fkey TO oraculo_usage_organization_id_fkey;
ALTER TABLE public.oraculo_usage
  RENAME CONSTRAINT oraculo_legacy_usage_archive_user_fkey TO oraculo_usage_user_id_fkey;
ALTER INDEX public.idx_oraculo_legacy_usage_archive_user_date RENAME TO idx_oraculo_usage_user_date;
ALTER INDEX public.idx_oraculo_legacy_usage_archive_org RENAME TO idx_oraculo_usage_org;

COMMENT ON TABLE public.oraculo_usage IS NULL;

CREATE POLICY "Users can view own oraculo usage"
  ON public.oraculo_usage FOR SELECT
  USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can insert own oraculo usage"
  ON public.oraculo_usage FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "master_ghost_all_oraculo_usage"
  ON public.oraculo_usage
  USING ((SELECT public.is_master_user()))
  WITH CHECK ((SELECT public.is_master_user()));
CREATE POLICY "master_ghost_select_oraculo_usage"
  ON public.oraculo_usage FOR SELECT
  USING ((SELECT public.is_master_user()));

GRANT SELECT, REFERENCES, TRIGGER ON TABLE public.oraculo_usage TO anon;
GRANT ALL ON TABLE public.oraculo_usage TO authenticated, service_role;
DO $block$
BEGIN
  IF current_setting('server_version_num')::integer >= 170000 THEN
    EXECUTE 'GRANT MAINTAIN ON TABLE public.oraculo_usage TO anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_readonly') THEN
    EXECUTE 'GRANT SELECT ON TABLE public.oraculo_usage TO mcp_readonly';
  END IF;
END
$block$;

CREATE OR REPLACE FUNCTION public.check_oraculo_limit(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_used integer;
  v_limit integer := 3;
BEGIN
  SELECT count(*) INTO v_used
  FROM public.oraculo_usage
  WHERE user_id = p_user_id
    AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
    AND created_at < date_trunc('day', now() AT TIME ZONE 'UTC') + interval '1 day';

  RETURN jsonb_build_object(
    'used', v_used,
    'remaining', greatest(v_limit - v_used, 0),
    'limit', v_limit
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.record_oraculo_usage(
  p_user_id uuid,
  p_org_id uuid,
  p_question text,
  p_response text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_used integer;
  v_limit integer := 3;
BEGIN
  SELECT count(*) INTO v_used
  FROM public.oraculo_usage
  WHERE user_id = p_user_id
    AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
    AND created_at < date_trunc('day', now() AT TIME ZONE 'UTC') + interval '1 day';

  IF v_used >= v_limit THEN
    RETURN jsonb_build_object('error', 'limit_exceeded', 'used', v_used, 'remaining', 0);
  END IF;

  INSERT INTO public.oraculo_usage (user_id, organization_id, question, response)
  VALUES (p_user_id, p_org_id, p_question, p_response);

  RETURN jsonb_build_object('used', v_used + 1, 'remaining', v_limit - v_used - 1);
END
$function$;

REVOKE ALL ON FUNCTION public.check_oraculo_limit(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_oraculo_limit(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_oraculo_usage(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_oraculo_usage(uuid, uuid, text, text) TO service_role;

COMMIT;
