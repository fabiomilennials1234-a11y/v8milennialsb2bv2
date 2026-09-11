-- Capture rules at insertion, covering SQL and Edge execution producers alike.
-- Existing executions remain unversioned: never manufacture historical rules.
BEGIN;
ALTER TABLE public.workflow_executions ADD COLUMN IF NOT EXISTS guided_version_id uuid;
ALTER TABLE public.workflow_executions DROP CONSTRAINT IF EXISTS workflow_executions_guided_version_fk;
ALTER TABLE public.workflow_executions ADD CONSTRAINT workflow_executions_guided_version_fk
  FOREIGN KEY (workflow_id, organization_id, guided_version_id)
  REFERENCES public.workflow_guided_versions(workflow_id, organization_id, id);
CREATE INDEX IF NOT EXISTS workflow_executions_guided_version_idx
  ON public.workflow_executions(guided_version_id) WHERE guided_version_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.pin_guided_execution_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.guided_version_id IS DISTINCT FROM OLD.guided_version_id
      OR (OLD.guided_version_id IS NOT NULL AND
        (NEW.workflow_id IS DISTINCT FROM OLD.workflow_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id)) THEN
      RAISE EXCEPTION 'execution_version_immutable' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  -- Same parent lock as publication. Insertion observes one committed selection,
  -- and a concurrent publisher waits until this execution is committed.
  PERFORM 1 FROM public.workflows w WHERE w.id = NEW.workflow_id
    AND w.organization_id = NEW.organization_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  SELECT p.version_id INTO NEW.guided_version_id FROM public.workflow_guided_publications p
    WHERE p.workflow_id = NEW.workflow_id AND p.organization_id = NEW.organization_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.pin_guided_execution_version() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS pin_guided_execution_version ON public.workflow_executions;
CREATE TRIGGER pin_guided_execution_version BEFORE INSERT OR UPDATE OF guided_version_id, workflow_id, organization_id
  ON public.workflow_executions FOR EACH ROW EXECUTE FUNCTION public.pin_guided_execution_version();
NOTIFY pgrst, 'reload schema';
COMMIT;
