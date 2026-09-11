-- Run against QA with test.organization_id/test.lead_id set to controlled fixtures.
-- All data is rolled back; no running execution or provider send is created.
BEGIN;
DO $$
DECLARE
  org uuid := current_setting('test.organization_id')::uuid;
  lead uuid := current_setting('test.lead_id')::uuid;
  wf uuid := gen_random_uuid();
  inserted uuid;
BEGIN
  INSERT INTO public.workflows(id,organization_id,name,trigger_type,is_active)
  VALUES(wf,org,'QA enrollment guard','manual',false);
  INSERT INTO public.workflow_executions(workflow_id,organization_id,lead_id,status)
  VALUES(wf,org,lead,'cancelled') RETURNING id INTO inserted;
  ASSERT inserted IS NOT NULL, 'First enrollment must pass';
  INSERT INTO public.workflow_executions(workflow_id,organization_id,lead_id,status)
  VALUES(wf,org,lead,'cancelled') RETURNING id INTO inserted;
  ASSERT inserted IS NULL, 'Disabled reenrollment must reject';
  UPDATE public.workflows SET re_enrollment_enabled=true,re_enrollment_max_times=2,
    re_enrollment_cooldown_days=30 WHERE id=wf;
  INSERT INTO public.workflow_executions(workflow_id,organization_id,lead_id,status)
  VALUES(wf,org,lead,'cancelled') RETURNING id INTO inserted;
  ASSERT inserted IS NULL, 'Cooldown must reject';
  UPDATE public.workflows SET re_enrollment_cooldown_days=0 WHERE id=wf;
  INSERT INTO public.workflow_executions(workflow_id,organization_id,lead_id,status)
  VALUES(wf,org,lead,'cancelled') RETURNING id INTO inserted;
  ASSERT inserted IS NOT NULL, 'Permitted enrollment must pass';
  INSERT INTO public.workflow_executions(workflow_id,organization_id,lead_id,status)
  VALUES(wf,org,lead,'cancelled') RETURNING id INTO inserted;
  ASSERT inserted IS NULL, 'Maximum total enrollments must reject';
  UPDATE public.workflows SET re_enrollment_max_times=3 WHERE id=wf;
  UPDATE public.workflow_executions SET status='running' WHERE workflow_id=wf;
  INSERT INTO public.workflow_executions(workflow_id,organization_id,lead_id,status)
  VALUES(wf,org,lead,'cancelled') RETURNING id INTO inserted;
  ASSERT inserted IS NULL, 'In-flight enrollment must reject even when reenrollment is enabled';
END $$;
ROLLBACK;
