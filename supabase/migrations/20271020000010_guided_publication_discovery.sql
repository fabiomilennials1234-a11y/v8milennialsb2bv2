-- Keep the existing trigger-discovery surface synchronized with publication.
-- No backfill and no activation: metadata changes only on a new publication.
BEGIN;
CREATE OR REPLACE FUNCTION public.sync_guided_publication_discovery()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_version public.workflow_guided_versions;
  v_trigger jsonb;
  v_count integer;
BEGIN
  SELECT * INTO v_version FROM public.workflow_guided_versions v
    WHERE v.id = NEW.version_id AND v.workflow_id = NEW.workflow_id AND v.organization_id = NEW.organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  SELECT count(*) INTO v_count FROM jsonb_array_elements(v_version.definition -> 'nodes') n WHERE n ->> 'type' = 'trigger';
  IF v_count <> 1 THEN RAISE EXCEPTION 'invalid_trigger' USING ERRCODE = '22023'; END IF;
  SELECT n -> 'data' INTO v_trigger FROM jsonb_array_elements(v_version.definition -> 'nodes') n WHERE n ->> 'type' = 'trigger';
  IF jsonb_typeof(v_trigger -> 'triggerType') IS DISTINCT FROM 'string'
    OR btrim(v_trigger ->> 'triggerType') = ''
    OR jsonb_typeof(coalesce(v_trigger -> 'config', '{}'::jsonb)) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid_trigger' USING ERRCODE = '22023';
  END IF;
  UPDATE public.workflows SET name = v_version.settings ->> 'name',
    trigger_type = v_trigger ->> 'triggerType', trigger_config = coalesce(v_trigger -> 'config', '{}'::jsonb)
    WHERE id = NEW.workflow_id AND organization_id = NEW.organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_guided_publication_discovery() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS sync_guided_publication_discovery ON public.workflow_guided_publications;
CREATE TRIGGER sync_guided_publication_discovery AFTER INSERT OR UPDATE OF version_id
  ON public.workflow_guided_publications FOR EACH ROW EXECUTE FUNCTION public.sync_guided_publication_discovery();
NOTIFY pgrst, 'reload schema';
COMMIT;
