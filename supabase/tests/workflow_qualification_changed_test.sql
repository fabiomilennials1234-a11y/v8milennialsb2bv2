-- 20280103000000 — gatilho "Qualificação alterada" (qualification_changed).

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone)
VALUES ('deadbeef-0103-4000-8000-000000000001', 'Org qualificação', 'org-qualificacao', 'America/Sao_Paulo');

INSERT INTO public.pipelines (id, organization_id, name, slug, type)
VALUES ('deadbeef-0103-4000-8000-000000000002', 'deadbeef-0103-4000-8000-000000000001', 'Funil', 'funil-q', 'custom');

INSERT INTO public.pipeline_stages (id, organization_id, pipeline_id, pipeline_type, stage_key, name, position)
VALUES
  ('deadbeef-0103-4000-8000-000000000003', 'deadbeef-0103-4000-8000-000000000001', 'deadbeef-0103-4000-8000-000000000002', 'custom', 'rep', 'Rep', 0),
  ('deadbeef-0103-4000-8000-000000000004', 'deadbeef-0103-4000-8000-000000000001', 'deadbeef-0103-4000-8000-000000000002', 'custom', 'cli', 'Cliente', 1);

INSERT INTO public.leads (id, organization_id, name)
VALUES
  ('deadbeef-0103-4000-8000-000000000005', 'deadbeef-0103-4000-8000-000000000001', 'Rep'),
  ('deadbeef-0103-4000-8000-000000000006', 'deadbeef-0103-4000-8000-000000000001', 'Cliente');

INSERT INTO public.pipeline_entries (organization_id, lead_id, pipeline_id, stage_id, stage_key)
VALUES
  ('deadbeef-0103-4000-8000-000000000001', 'deadbeef-0103-4000-8000-000000000005', 'deadbeef-0103-4000-8000-000000000002', 'deadbeef-0103-4000-8000-000000000003', 'rep'),
  ('deadbeef-0103-4000-8000-000000000001', 'deadbeef-0103-4000-8000-000000000006', 'deadbeef-0103-4000-8000-000000000002', 'deadbeef-0103-4000-8000-000000000004', 'cli');

INSERT INTO public.workflows (id, organization_id, name, is_active, trigger_type, trigger_config)
VALUES
  ('deadbeef-0103-4000-8000-000000000010', 'deadbeef-0103-4000-8000-000000000001', 'Rep prata+', true, 'qualification_changed',
   '{"tiers":["diamante","ouro","prata"],"stage_ids":["deadbeef-0103-4000-8000-000000000003"]}'::jsonb),
  ('deadbeef-0103-4000-8000-000000000011', 'deadbeef-0103-4000-8000-000000000001', 'Qualquer', true, 'qualification_changed', '{}'::jsonb),
  ('deadbeef-0103-4000-8000-000000000012', 'deadbeef-0103-4000-8000-000000000001', 'Inválida', true, 'qualification_changed', '{"tiers":"prata"}'::jsonb);

SET LOCAL session_replication_role = origin;

UPDATE public.leads SET pre_qualification_tier = 'prata' WHERE id = 'deadbeef-0103-4000-8000-000000000005';
SELECT results_eq(
  $$ SELECT w.name FROM public.workflow_executions e JOIN public.workflows w ON w.id = e.workflow_id
     WHERE e.lead_id = 'deadbeef-0103-4000-8000-000000000005' ORDER BY w.name $$,
  ARRAY['Qualquer', 'Rep prata+'],
  'rep em prata dispara o filtro de rep e o genérico; config inválida não dispara'
);
SELECT is(
  (SELECT context->>'new_tier' || '|' || (context->>'field') FROM public.workflow_executions e
   WHERE e.lead_id = 'deadbeef-0103-4000-8000-000000000005' AND e.workflow_id = 'deadbeef-0103-4000-8000-000000000011'),
  'prata|pre_qualification_tier',
  'contexto leva campo e nível novo'
);

UPDATE public.leads SET pre_qualification_tier = 'diamante' WHERE id = 'deadbeef-0103-4000-8000-000000000006';
SELECT results_eq(
  $$ SELECT w.name FROM public.workflow_executions e JOIN public.workflows w ON w.id = e.workflow_id
     WHERE e.lead_id = 'deadbeef-0103-4000-8000-000000000006' $$,
  ARRAY['Qualquer'],
  'cliente fora da etapa de rep não casa o filtro de etapa'
);

DELETE FROM public.workflow_executions WHERE organization_id = 'deadbeef-0103-4000-8000-000000000001';
UPDATE public.leads SET pre_qualification_tier = 'bronze' WHERE id = 'deadbeef-0103-4000-8000-000000000005';
SELECT results_eq(
  $$ SELECT w.name FROM public.workflow_executions e JOIN public.workflows w ON w.id = e.workflow_id
     WHERE e.lead_id = 'deadbeef-0103-4000-8000-000000000005' $$,
  ARRAY['Qualquer'],
  'bronze não passa no filtro prata+'
);

DELETE FROM public.workflow_executions WHERE organization_id = 'deadbeef-0103-4000-8000-000000000001';
UPDATE public.leads SET pre_qualification_tier = NULL WHERE id = 'deadbeef-0103-4000-8000-000000000005';
SELECT is(
  (SELECT count(*)::int FROM public.workflow_executions WHERE lead_id = 'deadbeef-0103-4000-8000-000000000005'),
  0,
  'limpar o nível não dispara'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.trigger_workflow_qualification_changed()', 'execute')
  AND NOT has_function_privilege('anon', 'public.trigger_workflow_qualification_changed()', 'execute'),
  'função do gatilho não é executável por anon/authenticated'
);

SELECT * FROM finish();
ROLLBACK;
