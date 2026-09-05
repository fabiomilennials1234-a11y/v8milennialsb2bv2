-- GitHub #2003 / SCRUM-676 — filtro usa o funil congelado no nascimento.
-- Seam: INSERT real em deals/pipeline_entries e execução resultante.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone)
VALUES ('deadbeef-2003-4000-8000-000000000001', 'Org filtro funil', 'org-filtro-funil', 'America/Sao_Paulo');

INSERT INTO public.leads (id, organization_id, name)
VALUES ('deadbeef-2003-4000-8000-000000000002', 'deadbeef-2003-4000-8000-000000000001', 'Lead filtro funil');

INSERT INTO public.pipelines (id, organization_id, name, slug, type)
VALUES
  ('deadbeef-2003-4000-8000-000000000003', 'deadbeef-2003-4000-8000-000000000001', 'Funil A', 'funil-a', 'custom'),
  ('deadbeef-2003-4000-8000-000000000004', 'deadbeef-2003-4000-8000-000000000001', 'Funil B', 'funil-b', 'custom');

INSERT INTO public.pipeline_stages (id, organization_id, pipeline_id, pipeline_type, stage_key, name, position)
VALUES
  ('deadbeef-2003-4000-8000-000000000005', 'deadbeef-2003-4000-8000-000000000001', 'deadbeef-2003-4000-8000-000000000003', 'custom', 'novo-a', 'Novo A', 0),
  ('deadbeef-2003-4000-8000-000000000006', 'deadbeef-2003-4000-8000-000000000001', 'deadbeef-2003-4000-8000-000000000004', 'custom', 'novo-b', 'Novo B', 0);

INSERT INTO public.workflows (id, organization_id, name, is_active, trigger_type, trigger_config)
VALUES
  ('deadbeef-2003-4000-8000-000000000010', 'deadbeef-2003-4000-8000-000000000001', 'Qualquer funil', true, 'deal_created', '{}'::jsonb),
  ('deadbeef-2003-4000-8000-000000000011', 'deadbeef-2003-4000-8000-000000000001', 'Somente A', true, 'deal_created', jsonb_build_object('pipeline_ids', jsonb_build_array('deadbeef-2003-4000-8000-000000000003'))),
  ('deadbeef-2003-4000-8000-000000000012', 'deadbeef-2003-4000-8000-000000000001', 'Somente B', true, 'deal_created', jsonb_build_object('pipeline_ids', jsonb_build_array('deadbeef-2003-4000-8000-000000000004'))),
  ('deadbeef-2003-4000-8000-000000000013', 'deadbeef-2003-4000-8000-000000000001', 'A ou B', true, 'deal_created', jsonb_build_object('pipeline_ids', jsonb_build_array('deadbeef-2003-4000-8000-000000000003', 'deadbeef-2003-4000-8000-000000000004'))),
  ('deadbeef-2003-4000-8000-000000000014', 'deadbeef-2003-4000-8000-000000000001', 'Tipo inválido', true, 'deal_created', jsonb_build_object('pipeline_ids', 'deadbeef-2003-4000-8000-000000000004')),
  ('deadbeef-2003-4000-8000-000000000015', 'deadbeef-2003-4000-8000-000000000001', 'Item inválido', true, 'deal_created', jsonb_build_object('pipeline_ids', jsonb_build_array('deadbeef-2003-4000-8000-000000000004', 42))),
  ('deadbeef-2003-4000-8000-000000000016', 'deadbeef-2003-4000-8000-000000000001', 'Funil certo e origem errada', true, 'deal_created', jsonb_build_object('pipeline_ids', jsonb_build_array('deadbeef-2003-4000-8000-000000000004'), 'source', 'human'));

SET LOCAL session_replication_role = origin;

INSERT INTO public.deals (id, organization_id, source_lead_id, title, value, source)
VALUES ('deadbeef-2003-4000-8000-000000000020', 'deadbeef-2003-4000-8000-000000000001', 'deadbeef-2003-4000-8000-000000000002', 'Negócio no B', 1200, 'api');

INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, deal_id, stage_key, stage_id)
VALUES ('deadbeef-2003-4000-8000-000000000021', 'deadbeef-2003-4000-8000-000000000001', 'deadbeef-2003-4000-8000-000000000004', 'deadbeef-2003-4000-8000-000000000002', 'deadbeef-2003-4000-8000-000000000020', 'novo-b', 'deadbeef-2003-4000-8000-000000000006');

SELECT results_eq(
  $$ SELECT workflow_id FROM public.workflow_executions ORDER BY workflow_id $$,
  $$ VALUES
    ('deadbeef-2003-4000-8000-000000000010'::uuid),
    ('deadbeef-2003-4000-8000-000000000012'::uuid),
    ('deadbeef-2003-4000-8000-000000000013'::uuid)
  $$,
  '(FUNIL) banco cria execução só para qualquer funil, B e A-ou-B'
);

SELECT is(
  public.matches_workflow_trigger_config(
    'deal_created',
    jsonb_build_object('pipeline_ids', jsonb_build_array('deadbeef-2003-4000-8000-000000000004')),
    '{}'::jsonb
  ),
  false,
  '(FAIL-CLOSED) matcher SQL recusa contexto sem pipeline_id'
);

ROLLBACK;
