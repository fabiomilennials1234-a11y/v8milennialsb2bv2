-- GitHub #2004 / SCRUM-677 — etapa de nascimento é filtro global entre funis.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone)
VALUES ('deadbeef-2004-4000-8000-000000000001', 'Org filtro etapa', 'org-filtro-etapa', 'America/Sao_Paulo');

INSERT INTO public.leads (id, organization_id, name)
VALUES ('deadbeef-2004-4000-8000-000000000002', 'deadbeef-2004-4000-8000-000000000001', 'Lead filtro etapa');

INSERT INTO public.pipelines (id, organization_id, name, slug, type)
VALUES
  ('deadbeef-2004-4000-8000-000000000003', 'deadbeef-2004-4000-8000-000000000001', 'Funil A', 'funil-a', 'custom'),
  ('deadbeef-2004-4000-8000-000000000004', 'deadbeef-2004-4000-8000-000000000001', 'Funil B', 'funil-b', 'custom');

INSERT INTO public.pipeline_stages (id, organization_id, pipeline_id, pipeline_type, stage_key, name, position)
VALUES
  ('deadbeef-2004-4000-8000-000000000005', 'deadbeef-2004-4000-8000-000000000001', 'deadbeef-2004-4000-8000-000000000003', 'custom', 'a-um', 'A Um', 0),
  ('deadbeef-2004-4000-8000-000000000006', 'deadbeef-2004-4000-8000-000000000001', 'deadbeef-2004-4000-8000-000000000003', 'custom', 'a-dois', 'A Dois', 1),
  ('deadbeef-2004-4000-8000-000000000007', 'deadbeef-2004-4000-8000-000000000001', 'deadbeef-2004-4000-8000-000000000004', 'custom', 'b-um', 'B Um', 0),
  ('deadbeef-2004-4000-8000-000000000008', 'deadbeef-2004-4000-8000-000000000001', 'deadbeef-2004-4000-8000-000000000004', 'custom', 'b-dois', 'B Dois', 1);

INSERT INTO public.workflows (id, organization_id, name, is_active, trigger_type, trigger_config)
VALUES
  ('deadbeef-2004-4000-8000-000000000010', 'deadbeef-2004-4000-8000-000000000001', 'B qualquer etapa', true, 'deal_created', jsonb_build_object('pipeline_ids', jsonb_build_array('deadbeef-2004-4000-8000-000000000004'))),
  ('deadbeef-2004-4000-8000-000000000011', 'deadbeef-2004-4000-8000-000000000001', 'B um', true, 'deal_created', jsonb_build_object('pipeline_ids', jsonb_build_array('deadbeef-2004-4000-8000-000000000004'), 'stage_ids', jsonb_build_array('deadbeef-2004-4000-8000-000000000007'))),
  ('deadbeef-2004-4000-8000-000000000012', 'deadbeef-2004-4000-8000-000000000001', 'B dois', true, 'deal_created', jsonb_build_object('pipeline_ids', jsonb_build_array('deadbeef-2004-4000-8000-000000000004'), 'stage_ids', jsonb_build_array('deadbeef-2004-4000-8000-000000000008'))),
  ('deadbeef-2004-4000-8000-000000000013', 'deadbeef-2004-4000-8000-000000000001', 'A ou B mas só A um', true, 'deal_created', jsonb_build_object('pipeline_ids', jsonb_build_array('deadbeef-2004-4000-8000-000000000003', 'deadbeef-2004-4000-8000-000000000004'), 'stage_ids', jsonb_build_array('deadbeef-2004-4000-8000-000000000005'))),
  ('deadbeef-2004-4000-8000-000000000014', 'deadbeef-2004-4000-8000-000000000001', 'A ou B e A um ou B um', true, 'deal_created', jsonb_build_object('pipeline_ids', jsonb_build_array('deadbeef-2004-4000-8000-000000000003', 'deadbeef-2004-4000-8000-000000000004'), 'stage_ids', jsonb_build_array('deadbeef-2004-4000-8000-000000000005', 'deadbeef-2004-4000-8000-000000000007'))),
  ('deadbeef-2004-4000-8000-000000000015', 'deadbeef-2004-4000-8000-000000000001', 'Etapa sem funil', true, 'deal_created', jsonb_build_object('stage_ids', jsonb_build_array('deadbeef-2004-4000-8000-000000000007'))),
  ('deadbeef-2004-4000-8000-000000000016', 'deadbeef-2004-4000-8000-000000000001', 'Etapa tipo inválido', true, 'deal_created', jsonb_build_object('pipeline_ids', jsonb_build_array('deadbeef-2004-4000-8000-000000000004'), 'stage_ids', 'deadbeef-2004-4000-8000-000000000007'));

SET LOCAL session_replication_role = origin;

INSERT INTO public.deals (id, organization_id, source_lead_id, title, value, source)
VALUES ('deadbeef-2004-4000-8000-000000000020', 'deadbeef-2004-4000-8000-000000000001', 'deadbeef-2004-4000-8000-000000000002', 'Negócio em B Um', 1000, 'human');

INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, deal_id, stage_key, stage_id)
VALUES ('deadbeef-2004-4000-8000-000000000021', 'deadbeef-2004-4000-8000-000000000001', 'deadbeef-2004-4000-8000-000000000004', 'deadbeef-2004-4000-8000-000000000002', 'deadbeef-2004-4000-8000-000000000020', 'b-um', 'deadbeef-2004-4000-8000-000000000007');

SELECT results_eq(
  $$ SELECT workflow_id FROM public.workflow_executions ORDER BY workflow_id $$,
  $$ VALUES
    ('deadbeef-2004-4000-8000-000000000010'::uuid),
    ('deadbeef-2004-4000-8000-000000000011'::uuid),
    ('deadbeef-2004-4000-8000-000000000014'::uuid)
  $$,
  '(ETAPA GLOBAL) B Um casa B/qualquer, B/Um e A-ou-B/A-Um-ou-B-Um'
);

SELECT is(
  public.matches_workflow_trigger_config(
    'deal_created',
    jsonb_build_object('pipeline_ids', jsonb_build_array('deadbeef-2004-4000-8000-000000000004'), 'stage_ids', jsonb_build_array('deadbeef-2004-4000-8000-000000000007')),
    jsonb_build_object('lead_id', 'deadbeef-2004-4000-8000-000000000002', 'pipeline_id', 'deadbeef-2004-4000-8000-000000000004')
  ),
  false,
  '(FAIL-CLOSED) matcher SQL recusa contexto sem stage_id'
);

ROLLBACK;
