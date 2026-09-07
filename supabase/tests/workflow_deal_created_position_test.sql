-- supabase/tests/workflow_deal_created_position_test.sql
--
-- GitHub #2002 / SCRUM-675 — o Negócio nasce para automações quando sua
-- posição canônica fica completa, não no INSERT isolado de `deals`.
--
-- Seam público: writes reais em `deals`/`pipeline_entries`, observados pela
-- execução produzida. O teste não chama a função de trigger diretamente.
--
-- Run: DATABASE_URL=<preview> bash supabase/tests/run.sh
-- Roda inteiro em transação revertida.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone)
VALUES (
  'deadbeef-2002-4000-8000-000000000001',
  'Org deal_created posição',
  'org-deal-created-posicao',
  'America/Sao_Paulo'
);

INSERT INTO public.leads (id, organization_id, name)
VALUES
  (
    'deadbeef-2002-4000-8000-000000000002',
    'deadbeef-2002-4000-8000-000000000001',
    'Lead do nascimento'
  ),
  (
    'deadbeef-2002-4000-8000-000000000013',
    'deadbeef-2002-4000-8000-000000000001',
    'Outro Lead da mesma organização'
  );

INSERT INTO public.pipelines (id, organization_id, name, slug, type)
VALUES (
  'deadbeef-2002-4000-8000-000000000003',
  'deadbeef-2002-4000-8000-000000000001',
  'Funil do nascimento',
  'whatsapp',
  'system'
);

INSERT INTO public.pipeline_stages (
  id, organization_id, pipeline_id, pipeline_type, stage_key, name, position
) VALUES
  (
    'deadbeef-2002-4000-8000-000000000004',
    'deadbeef-2002-4000-8000-000000000001',
    'deadbeef-2002-4000-8000-000000000003',
    'whatsapp',
    'novo_lead',
    'Novo',
    0
  ),
  (
    'deadbeef-2002-4000-8000-000000000012',
    'deadbeef-2002-4000-8000-000000000001',
    'deadbeef-2002-4000-8000-000000000003',
    'whatsapp',
    'abordado',
    'Abordado',
    1
  );

INSERT INTO public.workflows (
  id, organization_id, name, is_active, trigger_type, trigger_config
) VALUES (
  'deadbeef-2002-4000-8000-000000000005',
  'deadbeef-2002-4000-8000-000000000001',
  'Negócio criado em qualquer posição',
  true,
  'deal_created',
  '{}'::jsonb
);

SET LOCAL session_replication_role = origin;

INSERT INTO public.deals (
  id, organization_id, source_lead_id, title, value, source
) VALUES (
  'deadbeef-2002-4000-8000-000000000006',
  'deadbeef-2002-4000-8000-000000000001',
  'deadbeef-2002-4000-8000-000000000002',
  'Negócio ainda sem posição',
  1500,
  'api'
);

SELECT is(
  (SELECT count(*) FROM public.workflow_executions
    WHERE workflow_id = 'deadbeef-2002-4000-8000-000000000005'),
  0::bigint,
  '(NASCIMENTO) INSERT isolado em deals ainda não dispara deal_created'
);

INSERT INTO public.pipeline_entries (
  id, organization_id, pipeline_id, lead_id, deal_id, stage_key, stage_id
) VALUES (
  'deadbeef-2002-4000-8000-000000000007',
  'deadbeef-2002-4000-8000-000000000001',
  'deadbeef-2002-4000-8000-000000000003',
  'deadbeef-2002-4000-8000-000000000002',
  'deadbeef-2002-4000-8000-000000000006',
  'novo_lead',
  'deadbeef-2002-4000-8000-000000000004'
);

SELECT is(
  (SELECT count(*) FROM public.workflow_executions
    WHERE workflow_id = 'deadbeef-2002-4000-8000-000000000005'),
  1::bigint,
  '(NASCIMENTO) primeira posição completa dispara exatamente uma execução'
);

SELECT results_eq(
  $$
    SELECT
      pipeline_entry_id,
      deal_id,
      context->>'pipeline_entry_id',
      context->>'deal_id',
      context->>'pipeline_id',
      context->>'stage_id'
    FROM public.workflow_executions
    WHERE workflow_id = 'deadbeef-2002-4000-8000-000000000005'
  $$,
  $$ VALUES (
    'deadbeef-2002-4000-8000-000000000007'::uuid,
    'deadbeef-2002-4000-8000-000000000006'::uuid,
    'deadbeef-2002-4000-8000-000000000007'::text,
    'deadbeef-2002-4000-8000-000000000006'::text,
    'deadbeef-2002-4000-8000-000000000003'::text,
    'deadbeef-2002-4000-8000-000000000004'::text
  ) $$,
  '(SNAPSHOT) execução declara o Negócio e congela a posição de nascimento'
);

INSERT INTO public.deals (
  id, organization_id, source_lead_id, title, source
) VALUES
  (
    'deadbeef-2002-4000-8000-000000000008',
    'deadbeef-2002-4000-8000-000000000001',
    'deadbeef-2002-4000-8000-000000000002',
    'Materialização técnica',
    'entrada_materializada'
  ),
  (
    'deadbeef-2002-4000-8000-000000000009',
    'deadbeef-2002-4000-8000-000000000001',
    'deadbeef-2002-4000-8000-000000000002',
    'Backfill geral',
    'backfill'
  ),
  (
    'deadbeef-2002-4000-8000-00000000000a',
    'deadbeef-2002-4000-8000-000000000001',
    'deadbeef-2002-4000-8000-000000000002',
    'Backfill de funil custom',
    'backfill_funil_custom'
  );

INSERT INTO public.pipeline_entries (
  id, organization_id, pipeline_id, lead_id, deal_id, stage_key, stage_id
) VALUES
  (
    'deadbeef-2002-4000-8000-00000000000b',
    'deadbeef-2002-4000-8000-000000000001',
    'deadbeef-2002-4000-8000-000000000003',
    'deadbeef-2002-4000-8000-000000000002',
    'deadbeef-2002-4000-8000-000000000008',
    'novo_lead',
    'deadbeef-2002-4000-8000-000000000004'
  ),
  (
    'deadbeef-2002-4000-8000-00000000000c',
    'deadbeef-2002-4000-8000-000000000001',
    'deadbeef-2002-4000-8000-000000000003',
    'deadbeef-2002-4000-8000-000000000002',
    'deadbeef-2002-4000-8000-000000000009',
    'novo_lead',
    'deadbeef-2002-4000-8000-000000000004'
  ),
  (
    'deadbeef-2002-4000-8000-00000000000d',
    'deadbeef-2002-4000-8000-000000000001',
    'deadbeef-2002-4000-8000-000000000003',
    'deadbeef-2002-4000-8000-000000000002',
    'deadbeef-2002-4000-8000-00000000000a',
    'novo_lead',
    'deadbeef-2002-4000-8000-000000000004'
  );

SELECT is(
  (SELECT count(*) FROM public.workflow_executions
    WHERE workflow_id = 'deadbeef-2002-4000-8000-000000000005'
      AND context->>'deal_source' IN (
        'entrada_materializada',
        'backfill',
        'backfill_funil_custom'
      )),
  0::bigint,
  '(PROCEDÊNCIA) materialização e backfills não simulam nascimento comercial'
);

INSERT INTO public.deals (
  id, organization_id, source_lead_id, title, source
) VALUES (
  'deadbeef-2002-4000-8000-00000000000e',
  'deadbeef-2002-4000-8000-000000000001',
  'deadbeef-2002-4000-8000-000000000002',
  'Negócio ligado depois',
  'api'
);

INSERT INTO public.pipeline_entries (
  id, organization_id, pipeline_id, lead_id, stage_key, stage_id
) VALUES (
  'deadbeef-2002-4000-8000-00000000000f',
  'deadbeef-2002-4000-8000-000000000001',
  'deadbeef-2002-4000-8000-000000000003',
  'deadbeef-2002-4000-8000-000000000002',
  'novo_lead',
  'deadbeef-2002-4000-8000-000000000004'
);

UPDATE public.pipeline_entries
SET deal_id = 'deadbeef-2002-4000-8000-00000000000e'
WHERE id = 'deadbeef-2002-4000-8000-00000000000f';

SELECT is(
  (SELECT count(*) FROM public.workflow_executions
    WHERE workflow_id = 'deadbeef-2002-4000-8000-000000000005'
      AND deal_id = 'deadbeef-2002-4000-8000-00000000000e'),
  1::bigint,
  '(ORDEM) vincular deal_id depois emite quando a posição fica completa'
);

INSERT INTO public.deals (
  id, organization_id, source_lead_id, title, source
) VALUES (
  'deadbeef-2002-4000-8000-000000000010',
  'deadbeef-2002-4000-8000-000000000001',
  'deadbeef-2002-4000-8000-000000000002',
  'Negócio cuja etapa chega depois',
  'api'
);

SET LOCAL session_replication_role = replica;
INSERT INTO public.pipeline_entries (
  id, organization_id, pipeline_id, lead_id, deal_id, stage_key, stage_id
) VALUES (
  'deadbeef-2002-4000-8000-000000000011',
  'deadbeef-2002-4000-8000-000000000001',
  'deadbeef-2002-4000-8000-000000000003',
  'deadbeef-2002-4000-8000-000000000002',
  'deadbeef-2002-4000-8000-000000000010',
  'novo_lead',
  NULL
);
SET LOCAL session_replication_role = origin;

UPDATE public.pipeline_entries
SET stage_id = 'deadbeef-2002-4000-8000-000000000004'
WHERE id = 'deadbeef-2002-4000-8000-000000000011';

SELECT is(
  (SELECT count(*) FROM public.workflow_executions
    WHERE workflow_id = 'deadbeef-2002-4000-8000-000000000005'
      AND deal_id = 'deadbeef-2002-4000-8000-000000000010'),
  1::bigint,
  '(ORDEM) preencher stage_id depois emite quando a posição fica completa'
);

UPDATE public.pipeline_entries
SET stage_id = 'deadbeef-2002-4000-8000-000000000012',
    stage_key = 'abordado'
WHERE id = 'deadbeef-2002-4000-8000-000000000007';

SELECT is(
  (SELECT count(*) FROM public.workflow_executions
    WHERE workflow_id = 'deadbeef-2002-4000-8000-000000000005'
      AND deal_id = 'deadbeef-2002-4000-8000-000000000006'),
  1::bigint,
  '(IMUTÁVEL) mover depois do nascimento não emite deal_created novamente'
);

INSERT INTO public.deals (
  id, organization_id, source_lead_id, title, source
) VALUES (
  'deadbeef-2002-4000-8000-000000000014',
  'deadbeef-2002-4000-8000-000000000001',
  'deadbeef-2002-4000-8000-000000000002',
  'Negócio com posição incoerente',
  'api'
);

INSERT INTO public.pipeline_entries (
  id, organization_id, pipeline_id, lead_id, deal_id, stage_key, stage_id
) VALUES (
  'deadbeef-2002-4000-8000-000000000015',
  'deadbeef-2002-4000-8000-000000000001',
  'deadbeef-2002-4000-8000-000000000003',
  'deadbeef-2002-4000-8000-000000000013',
  'deadbeef-2002-4000-8000-000000000014',
  'novo_lead',
  'deadbeef-2002-4000-8000-000000000004'
);

SELECT is(
  (SELECT count(*) FROM public.workflow_executions
    WHERE deal_id = 'deadbeef-2002-4000-8000-000000000014'),
  0::bigint,
  '(COERÊNCIA) posição de outro Lead não dispara workflow do Negócio'
);

SELECT is(
  (SELECT count(DISTINCT deal_id) FROM public.workflow_executions
    WHERE workflow_id = 'deadbeef-2002-4000-8000-000000000005'),
  3::bigint,
  '(SUJEITO) três Negócios do mesmo Lead produzem três execuções independentes'
);

SELECT public.fire_workflow_trigger(
  organization_id,
  'deal_created',
  lead_id,
  context - 'trigger_type' - 'trigger_config'
)
FROM public.workflow_executions
WHERE workflow_id = 'deadbeef-2002-4000-8000-000000000005'
  AND deal_id = 'deadbeef-2002-4000-8000-000000000006';

SELECT is(
  (SELECT count(*) FROM public.workflow_executions
    WHERE workflow_id = 'deadbeef-2002-4000-8000-000000000005'
      AND deal_id = 'deadbeef-2002-4000-8000-000000000006'),
  1::bigint,
  '(DEDUP) redisparo idêntico do mesmo Negócio não cria outra execução'
);

INSERT INTO public.deals (
  id, organization_id, source_lead_id, title, source, deleted_at
) VALUES (
  'deadbeef-2002-4000-8000-000000000016',
  'deadbeef-2002-4000-8000-000000000001',
  'deadbeef-2002-4000-8000-000000000002',
  'Negócio excluído',
  'api',
  now()
);

INSERT INTO public.pipeline_entries (
  id, organization_id, pipeline_id, lead_id, deal_id, stage_key, stage_id
) VALUES (
  'deadbeef-2002-4000-8000-000000000017',
  'deadbeef-2002-4000-8000-000000000001',
  'deadbeef-2002-4000-8000-000000000003',
  'deadbeef-2002-4000-8000-000000000002',
  'deadbeef-2002-4000-8000-000000000016',
  'novo_lead',
  'deadbeef-2002-4000-8000-000000000004'
);

SELECT is(
  (SELECT count(*) FROM public.workflow_executions
    WHERE deal_id = 'deadbeef-2002-4000-8000-000000000016'),
  0::bigint,
  '(EXCLUÍDO) posição de Negócio na lixeira não dispara workflow'
);

ROLLBACK;
