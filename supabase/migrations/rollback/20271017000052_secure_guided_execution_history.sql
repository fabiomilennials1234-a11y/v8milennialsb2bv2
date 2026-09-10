BEGIN;
DROP FUNCTION IF EXISTS public.retry_workflow_execution(uuid);
DROP FUNCTION IF EXISTS public.get_workflow_execution_stats(uuid);
DROP FUNCTION IF EXISTS public.get_workflow_execution_steps(uuid);
DROP FUNCTION IF EXISTS public.get_workflow_execution_history(uuid, integer);
DROP FUNCTION IF EXISTS public.can_read_guided_execution_data(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.guided_execution_safe_output(text, jsonb);
DROP FUNCTION IF EXISTS public.guided_execution_safe_error(text);

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
  PERFORM 1 FROM public.workflows w WHERE w.id = NEW.workflow_id
    AND w.organization_id = NEW.organization_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  SELECT p.version_id INTO NEW.guided_version_id FROM public.workflow_guided_publications p
    WHERE p.workflow_id = NEW.workflow_id AND p.organization_id = NEW.organization_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.pin_guided_execution_version() FROM PUBLIC, anon, authenticated, service_role;

DROP POLICY IF EXISTS workflow_executions_full_master_all ON public.workflow_executions;
CREATE POLICY workflow_executions_select ON public.workflow_executions
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()));
CREATE POLICY master_ghost_select_workflow_executions ON public.workflow_executions
  FOR SELECT TO authenticated USING ((SELECT public.is_master_user()));
CREATE POLICY master_ghost_all_workflow_executions ON public.workflow_executions
  FOR ALL TO authenticated USING ((SELECT public.is_master_user())) WITH CHECK ((SELECT public.is_master_user()));

DROP POLICY IF EXISTS workflow_execution_steps_full_master_all ON public.workflow_execution_steps;
CREATE POLICY workflow_execution_steps_select ON public.workflow_execution_steps
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workflow_executions e
    WHERE e.id = execution_id
      AND e.organization_id IN (SELECT public.get_my_organization_ids())
  ));
CREATE POLICY master_ghost_select_workflow_execution_steps ON public.workflow_execution_steps
  FOR SELECT TO authenticated USING ((SELECT public.is_master_user()));
CREATE POLICY master_ghost_all_workflow_execution_steps ON public.workflow_execution_steps
  FOR ALL TO authenticated USING ((SELECT public.is_master_user())) WITH CHECK ((SELECT public.is_master_user()));

GRANT EXECUTE ON FUNCTION public.claim_workflow_executions(integer, integer) TO PUBLIC, anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
