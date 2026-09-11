-- Preserve active-state/history; operator stops admission before rollback.
-- Keep a fail-closed activation guard while the capability is unavailable.
BEGIN;
DROP FUNCTION IF EXISTS public.set_guided_workflow_active(uuid, boolean, uuid);
CREATE OR REPLACE FUNCTION public.guard_guided_workflow_activation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.is_active AND EXISTS (SELECT 1 FROM public.workflow_guided_drafts d WHERE d.workflow_id = NEW.id) THEN
    RAISE EXCEPTION 'guided_activation_unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_guided_workflow_activation() FROM PUBLIC, anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
