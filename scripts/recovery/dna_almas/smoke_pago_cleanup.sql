-- smoke_pago_cleanup.sql — remove tudo do lead descartável do smoke (FK-safe). Idempotente.
DELETE FROM public.workflow_execution_steps WHERE execution_id IN
 (SELECT id FROM public.workflow_executions WHERE lead_id='dddddddd-dead-beef-cafe-000000000001');
DELETE FROM public.workflow_executions WHERE lead_id='dddddddd-dead-beef-cafe-000000000001';
DELETE FROM public.lead_tags WHERE lead_id='dddddddd-dead-beef-cafe-000000000001';
DELETE FROM public.pipeline_entries WHERE lead_id='dddddddd-dead-beef-cafe-000000000001';
DELETE FROM public.lead_history WHERE lead_id='dddddddd-dead-beef-cafe-000000000001';
DELETE FROM public.lead_custom_field_values WHERE lead_id='dddddddd-dead-beef-cafe-000000000001';
DELETE FROM public.leads WHERE id='dddddddd-dead-beef-cafe-000000000001';
SELECT (SELECT count(*) FROM public.leads WHERE id='dddddddd-dead-beef-cafe-000000000001') AS lead_remaining,
       (SELECT count(*) FROM public.workflow_executions WHERE lead_id='dddddddd-dead-beef-cafe-000000000001') AS exec_remaining;
