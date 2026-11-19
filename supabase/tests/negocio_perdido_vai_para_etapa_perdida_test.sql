-- supabase/tests/negocio_perdido_vai_para_etapa_perdida_test.sql
--
-- Migration 20280121020000 — negócio perdido vai para a etapa de perda (flag).
--
--   (FLAG-OFF)  org sem a flag: o card NÃO se move (comportamento de antes).
--   (NOME)      flag ligada, etapa `open` chamada "Perdido": o card vai.
--   (ROLE)      flag ligada, etapa stage_role=lost vence etapa só de nome.
--   (INATIVA)   etapa "Perdido" inativa é ignorada.
--   (SEM-ETAPA) funil sem etapa de perda: o card fica; a perda vale.
--   (JÁ-LÁ)    card já na etapa de perda não gera evento novo.
--
-- ⚠️ Fixtures sob `session_replication_role = replica`; as asserções voltam a
-- `origin` antes de exercitar o gatilho.
-- Run: bash supabase/tests/run.sh   (transação revertida)

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

SELECT has_trigger('public', 'deals', 'trg_negocio_perdido_vai_para_etapa_perdida',
  '(STRUCT) trigger existe em deals');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.fn_negocio_perdido_vai_para_etapa_perdida()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.fn_negocio_perdido_vai_para_etapa_perdida()', 'EXECUTE'),
  '(STRUCT) função DEFINER não é executável por anon/authenticated');

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone, feature_flags) VALUES
  ('deadbeef-0000-4000-8000-0000000a0001', 'Org Perda Ligada',   'org-perda-on',  'America/Sao_Paulo', '{"negocio_perdido_vai_para_etapa_perdida": true}'::jsonb),
  ('deadbeef-0000-4000-8000-0000000a0002', 'Org Perda Desligada', 'org-perda-off', 'America/Sao_Paulo', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name) VALUES
  ('deadbeef-0000-4000-8000-0000000a00a1', 'deadbeef-0000-4000-8000-0000000a0001', 'Lead On'),
  ('deadbeef-0000-4000-8000-0000000a00a2', 'deadbeef-0000-4000-8000-0000000a0002', 'Lead Off')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipelines (id, organization_id, name, slug, type) VALUES
  ('deadbeef-0000-4000-8000-0000000a00b1', 'deadbeef-0000-4000-8000-0000000a0001', 'Por nome',   'por-nome',   'custom'),
  ('deadbeef-0000-4000-8000-0000000a00b2', 'deadbeef-0000-4000-8000-0000000a0001', 'Por papel',  'por-papel',  'custom'),
  ('deadbeef-0000-4000-8000-0000000a00b3', 'deadbeef-0000-4000-8000-0000000a0001', 'Sem perda',  'sem-perda',  'custom'),
  ('deadbeef-0000-4000-8000-0000000a00b4', 'deadbeef-0000-4000-8000-0000000a0002', 'Flag off',   'flag-off',   'custom')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipeline_stages
  (id, organization_id, pipeline_id, pipeline_type, stage_key, name, position, stage_role, is_active, requires_sale_value)
VALUES
  -- P1: "Perdido" aberto por nome; uma "Perdido" inativa antes dela é ignorada.
  ('deadbeef-0000-4000-8000-0000000a01a1', 'deadbeef-0000-4000-8000-0000000a0001', 'deadbeef-0000-4000-8000-0000000a00b1', 'custom', 'prop_p1',   'Proposta',  0, 'open', true,  false),
  ('deadbeef-0000-4000-8000-0000000a01a2', 'deadbeef-0000-4000-8000-0000000a0001', 'deadbeef-0000-4000-8000-0000000a00b1', 'custom', 'perd_velho', '❌ Perdido', 1, 'open', false, false),
  ('deadbeef-0000-4000-8000-0000000a01a3', 'deadbeef-0000-4000-8000-0000000a0001', 'deadbeef-0000-4000-8000-0000000a00b1', 'custom', 'perdido',    'Perdido',   2, 'open', true,  false),
  -- P2: papel lost (nome neutro) vence etapa só de nome.
  ('deadbeef-0000-4000-8000-0000000a02a1', 'deadbeef-0000-4000-8000-0000000a0001', 'deadbeef-0000-4000-8000-0000000a00b2', 'custom', 'prop_p2',   'Proposta',  0, 'open', true,  false),
  ('deadbeef-0000-4000-8000-0000000a02a2', 'deadbeef-0000-4000-8000-0000000a0001', 'deadbeef-0000-4000-8000-0000000a00b2', 'custom', 'nome_perdido', 'Perdido por nome', 1, 'open', true, false),
  ('deadbeef-0000-4000-8000-0000000a02a3', 'deadbeef-0000-4000-8000-0000000a0001', 'deadbeef-0000-4000-8000-0000000a00b2', 'custom', 'descartado', 'Descartado', 2, 'lost', true,  false),
  -- P3: sem etapa de perda.
  ('deadbeef-0000-4000-8000-0000000a03a1', 'deadbeef-0000-4000-8000-0000000a0001', 'deadbeef-0000-4000-8000-0000000a00b3', 'custom', 'prop_p3',   'Proposta',  0, 'open', true,  false),
  -- P4: org sem a flag.
  ('deadbeef-0000-4000-8000-0000000a04a1', 'deadbeef-0000-4000-8000-0000000a0002', 'deadbeef-0000-4000-8000-0000000a00b4', 'custom', 'prop_p4',   'Proposta',  0, 'open', true,  false),
  ('deadbeef-0000-4000-8000-0000000a04a2', 'deadbeef-0000-4000-8000-0000000a0002', 'deadbeef-0000-4000-8000-0000000a00b4', 'custom', 'perdido',    'Perdido',   1, 'open', true,  false);

INSERT INTO public.deals (id, organization_id, source_lead_id, title, source, value) VALUES
  ('deadbeef-0000-4000-8000-0000000a0d01', 'deadbeef-0000-4000-8000-0000000a0001', 'deadbeef-0000-4000-8000-0000000a00a1', 'Nome',      'human', 100),
  ('deadbeef-0000-4000-8000-0000000a0d02', 'deadbeef-0000-4000-8000-0000000a0001', 'deadbeef-0000-4000-8000-0000000a00a1', 'Papel',     'human', 100),
  ('deadbeef-0000-4000-8000-0000000a0d03', 'deadbeef-0000-4000-8000-0000000a0001', 'deadbeef-0000-4000-8000-0000000a00a1', 'Sem etapa', 'human', 100),
  ('deadbeef-0000-4000-8000-0000000a0d04', 'deadbeef-0000-4000-8000-0000000a0002', 'deadbeef-0000-4000-8000-0000000a00a2', 'Flag off',  'human', 100),
  ('deadbeef-0000-4000-8000-0000000a0d05', 'deadbeef-0000-4000-8000-0000000a0001', 'deadbeef-0000-4000-8000-0000000a00a1', 'Já lá',     'human', 100);

INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key, stage_id, deal_id) VALUES
  ('deadbeef-0000-4000-8000-0000000a0e01', 'deadbeef-0000-4000-8000-0000000a0001', 'deadbeef-0000-4000-8000-0000000a00b1', 'deadbeef-0000-4000-8000-0000000a00a1', 'prop_p1', 'deadbeef-0000-4000-8000-0000000a01a1', 'deadbeef-0000-4000-8000-0000000a0d01'),
  ('deadbeef-0000-4000-8000-0000000a0e02', 'deadbeef-0000-4000-8000-0000000a0001', 'deadbeef-0000-4000-8000-0000000a00b2', 'deadbeef-0000-4000-8000-0000000a00a1', 'prop_p2', 'deadbeef-0000-4000-8000-0000000a02a1', 'deadbeef-0000-4000-8000-0000000a0d02'),
  ('deadbeef-0000-4000-8000-0000000a0e03', 'deadbeef-0000-4000-8000-0000000a0001', 'deadbeef-0000-4000-8000-0000000a00b3', 'deadbeef-0000-4000-8000-0000000a00a1', 'prop_p3', 'deadbeef-0000-4000-8000-0000000a03a1', 'deadbeef-0000-4000-8000-0000000a0d03'),
  ('deadbeef-0000-4000-8000-0000000a0e04', 'deadbeef-0000-4000-8000-0000000a0002', 'deadbeef-0000-4000-8000-0000000a00b4', 'deadbeef-0000-4000-8000-0000000a00a2', 'prop_p4', 'deadbeef-0000-4000-8000-0000000a04a1', 'deadbeef-0000-4000-8000-0000000a0d04'),
  ('deadbeef-0000-4000-8000-0000000a0e05', 'deadbeef-0000-4000-8000-0000000a0001', 'deadbeef-0000-4000-8000-0000000a00b1', 'deadbeef-0000-4000-8000-0000000a00a1', 'perdido', 'deadbeef-0000-4000-8000-0000000a01a3', 'deadbeef-0000-4000-8000-0000000a0d05');

SET LOCAL session_replication_role = origin;

-- (NOME) + (INATIVA)
UPDATE public.deals SET outcome = 'lost', outcome_source = 'ui' WHERE id = 'deadbeef-0000-4000-8000-0000000a0d01';
SELECT is((SELECT stage_key FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-0000000a0e01'),
  'perdido', '(NOME)(INATIVA) vai para o "Perdido" ativo, pulando o inativo');
SELECT is((SELECT stage_id FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-0000000a0e01'),
  'deadbeef-0000-4000-8000-0000000a01a3'::uuid, '(NOME) stage_id e stage_key andam juntos');
SELECT is((SELECT count(*)::int FROM public.pipeline_stage_events
            WHERE entry_id = 'deadbeef-0000-4000-8000-0000000a0e01'
              AND from_stage_key = 'prop_p1' AND to_stage_key = 'perdido'),
  1, '(NOME) a movimentação fica no histórico de etapas');

-- (ROLE)
UPDATE public.deals SET outcome = 'lost', outcome_source = 'ui' WHERE id = 'deadbeef-0000-4000-8000-0000000a0d02';
SELECT is((SELECT stage_key FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-0000000a0e02'),
  'descartado', '(ROLE) stage_role=lost vence etapa só de nome');

-- (SEM-ETAPA)
UPDATE public.deals SET outcome = 'lost', outcome_source = 'ui' WHERE id = 'deadbeef-0000-4000-8000-0000000a0d03';
SELECT is((SELECT stage_key FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-0000000a0e03'),
  'prop_p3', '(SEM-ETAPA) o card fica onde estava');
SELECT is((SELECT outcome FROM public.deals WHERE id = 'deadbeef-0000-4000-8000-0000000a0d03'),
  'lost', '(SEM-ETAPA) e a perda vale mesmo assim');

-- (FLAG-OFF)
UPDATE public.deals SET outcome = 'lost', outcome_source = 'ui' WHERE id = 'deadbeef-0000-4000-8000-0000000a0d04';
SELECT is((SELECT stage_key FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-0000000a0e04'),
  'prop_p4', '(FLAG-OFF) org sem a flag: o card não se move');
SELECT is((SELECT outcome FROM public.deals WHERE id = 'deadbeef-0000-4000-8000-0000000a0d04'),
  'lost', '(FLAG-OFF) a perda vale normalmente');

-- (JÁ-LÁ)
UPDATE public.deals SET outcome = 'lost', outcome_source = 'ui' WHERE id = 'deadbeef-0000-4000-8000-0000000a0d05';
SELECT is((SELECT count(*)::int FROM public.pipeline_stage_events WHERE entry_id = 'deadbeef-0000-4000-8000-0000000a0e05'),
  0, '(JÁ-LÁ) card já em "Perdido" não gera evento de etapa');

SELECT * FROM finish();
ROLLBACK;
