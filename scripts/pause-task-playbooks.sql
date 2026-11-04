-- Operator rollback: pause generation for ONE organization, preserving all data.
-- Set torque.task_pause_org in this connection before running this file:
-- SELECT set_config('torque.task_pause_org', '<organization UUID>', false);
-- Production execution requires explicit authorization per CONTRIBUTING.md.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $$
DECLARE v_org uuid:=nullif(current_setting('torque.task_pause_org',true),'')::uuid;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'Configure torque.task_pause_org com a organização alvo.'; END IF;
  UPDATE public.task_workspaces SET enabled=false WHERE organization_id=v_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organização sem workspace de tarefas ativo: %',v_org; END IF;
END;
$$;
COMMIT;
