-- GitHub #2005 / SCRUM-678 — exclusão de etapa é uma operação atômica.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone)
VALUES
  ('deadbeef-2005-4000-8000-000000000001', 'Org exclusão etapa', 'org-exclusao-etapa', 'America/Sao_Paulo'),
  ('deadbeef-2005-4000-8000-000000000002', 'Outra org', 'outra-org-exclusao-etapa', 'America/Sao_Paulo');

INSERT INTO public.leads (id, organization_id, name)
VALUES ('deadbeef-2005-4000-8000-000000000003', 'deadbeef-2005-4000-8000-000000000001', 'Lead com card');

INSERT INTO public.pipelines (id, organization_id, name, slug, type)
VALUES
  ('deadbeef-2005-4000-8000-000000000004', 'deadbeef-2005-4000-8000-000000000001', 'Funil principal', 'principal', 'custom'),
  ('deadbeef-2005-4000-8000-000000000005', 'deadbeef-2005-4000-8000-000000000002', 'Funil externo', 'externo', 'custom');

INSERT INTO public.pipeline_stages (id, organization_id, pipeline_id, pipeline_type, stage_key, name, position, is_active)
VALUES
  ('deadbeef-2005-4000-8000-000000000006', 'deadbeef-2005-4000-8000-000000000001', 'deadbeef-2005-4000-8000-000000000004', 'custom', 'origem', 'Origem', 0, true),
  ('deadbeef-2005-4000-8000-000000000007', 'deadbeef-2005-4000-8000-000000000001', 'deadbeef-2005-4000-8000-000000000004', 'custom', 'destino', 'Destino', 1, true),
  ('deadbeef-2005-4000-8000-000000000008', 'deadbeef-2005-4000-8000-000000000002', 'deadbeef-2005-4000-8000-000000000005', 'custom', 'externa', 'Externa', 0, true);

INSERT INTO public.deals (id, organization_id, source_lead_id, title, source)
VALUES ('deadbeef-2005-4000-8000-000000000009', 'deadbeef-2005-4000-8000-000000000001', 'deadbeef-2005-4000-8000-000000000003', 'Negócio do card', 'human');

INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, deal_id, stage_key, stage_id)
VALUES ('deadbeef-2005-4000-8000-00000000000a', 'deadbeef-2005-4000-8000-000000000001', 'deadbeef-2005-4000-8000-000000000004', 'deadbeef-2005-4000-8000-000000000003', 'deadbeef-2005-4000-8000-000000000009', 'origem', 'deadbeef-2005-4000-8000-000000000006');

INSERT INTO public.workflows (id, organization_id, name, is_active, trigger_type, trigger_config)
VALUES
  ('deadbeef-2005-4000-8000-000000000010', 'deadbeef-2005-4000-8000-000000000001', 'Referencia etapa', true, 'deal_created', jsonb_build_object('pipeline_ids', jsonb_build_array('deadbeef-2005-4000-8000-000000000004'), 'stage_ids', jsonb_build_array('deadbeef-2005-4000-8000-000000000006'))),
  ('deadbeef-2005-4000-8000-000000000011', 'deadbeef-2005-4000-8000-000000000001', 'Não referencia etapa', true, 'deal_created', jsonb_build_object('pipeline_ids', jsonb_build_array('deadbeef-2005-4000-8000-000000000004'), 'stage_ids', jsonb_build_array('deadbeef-2005-4000-8000-000000000007'))),
  ('deadbeef-2005-4000-8000-000000000012', 'deadbeef-2005-4000-8000-000000000001', 'Já inativo', false, 'deal_created', jsonb_build_object('stage_ids', jsonb_build_array('deadbeef-2005-4000-8000-000000000006')));

SET LOCAL session_replication_role = origin;
SET LOCAL role service_role;

SELECT is(
  public.pipeline_stage_delete_impact('deadbeef-2005-4000-8000-000000000006'::uuid)->>'automacoes',
  '1',
  '(PRÉVIA) informa uma automação ativa afetada'
);

SELECT throws_ok(
  $$ SELECT public.delete_pipeline_stage(
    'deadbeef-2005-4000-8000-000000000006'::uuid,
    'deadbeef-2005-4000-8000-000000000008'::uuid
  ) $$,
  'P0001',
  NULL,
  '(ATÔMICO) destino de outra organização é recusado'
);

SELECT results_eq(
  $$
    SELECT s.is_active, e.stage_id, w.is_active
    FROM public.pipeline_stages s
    JOIN public.pipeline_entries e ON e.id = 'deadbeef-2005-4000-8000-00000000000a'
    JOIN public.workflows w ON w.id = 'deadbeef-2005-4000-8000-000000000010'
    WHERE s.id = 'deadbeef-2005-4000-8000-000000000006'
  $$,
  $$ VALUES (true, 'deadbeef-2005-4000-8000-000000000006'::uuid, true) $$,
  '(ROLLBACK) falha não move card, não desativa etapa nem workflow'
);

CREATE FUNCTION pg_temp.fail_stage_deactivation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id = 'deadbeef-2005-4000-8000-000000000006'::uuid
     AND NOT NEW.is_active THEN
    RAISE EXCEPTION 'falha injetada depois dos writes' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER test_fail_stage_deactivation
BEFORE UPDATE ON public.pipeline_stages
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_stage_deactivation();

SELECT throws_ok(
  $$ SELECT public.delete_pipeline_stage(
    'deadbeef-2005-4000-8000-000000000006'::uuid,
    'deadbeef-2005-4000-8000-000000000007'::uuid
  ) $$,
  'P0001',
  'falha injetada depois dos writes',
  '(ATÔMICO) falha depois de mover cards reverte a operação inteira'
);

SELECT results_eq(
  $$
    SELECT s.is_active, e.stage_id, w.is_active
    FROM public.pipeline_stages s
    JOIN public.pipeline_entries e ON e.id = 'deadbeef-2005-4000-8000-00000000000a'
    JOIN public.workflows w ON w.id = 'deadbeef-2005-4000-8000-000000000010'
    WHERE s.id = 'deadbeef-2005-4000-8000-000000000006'
  $$,
  $$ VALUES (true, 'deadbeef-2005-4000-8000-000000000006'::uuid, true) $$,
  '(ROLLBACK REAL) falha final desfaz movimento e desativação do workflow'
);

SET LOCAL role postgres;
DROP TRIGGER test_fail_stage_deactivation ON public.pipeline_stages;
DROP FUNCTION pg_temp.fail_stage_deactivation();
SET LOCAL role service_role;

SELECT is(
  public.delete_pipeline_stage(
    'deadbeef-2005-4000-8000-000000000006'::uuid,
    'deadbeef-2005-4000-8000-000000000007'::uuid
  )->>'automacoes_desativadas',
  '1',
  '(RESULTADO) informa uma automação desativada'
);

SELECT results_eq(
  $$
    SELECT s.is_active, e.stage_id, e.stage_key
    FROM public.pipeline_stages s
    JOIN public.pipeline_entries e ON e.id = 'deadbeef-2005-4000-8000-00000000000a'
    WHERE s.id = 'deadbeef-2005-4000-8000-000000000006'
  $$,
  $$ VALUES (false, 'deadbeef-2005-4000-8000-000000000007'::uuid, 'destino'::text) $$,
  '(CONFIRMAÇÃO) move card e desativa etapa na mesma operação'
);

SELECT results_eq(
  $$ SELECT id, is_active FROM public.workflows ORDER BY id $$,
  $$ VALUES
    ('deadbeef-2005-4000-8000-000000000010'::uuid, false),
    ('deadbeef-2005-4000-8000-000000000011'::uuid, true),
    ('deadbeef-2005-4000-8000-000000000012'::uuid, false)
  $$,
  '(WORKFLOWS) só referência ativa à etapa removida é desativada'
);

ROLLBACK;
