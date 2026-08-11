-- supabase/tests/metric_leads_sem_responsavel_test.sql
--
-- SCRUM-311, fatia 1: medida `leads_sem_responsavel` no catálogo fechado.
--
-- Cobre o que pode dar errado de verdade:
--   (ZE) zero EXECUTE no leaf novo — 1º mandamento do ADR-0023
--   (GR) grants: anon e authenticated NÃO executam o leaf interno
--   (XO) isolamento cross-org
--   (CT) catálogo: medida, recortes e formato registrados
--   (VL) contagem correta, incluindo os guards de apagado e sombra
--   (SR) série por origem e por tag
--   (RC) recorte incompatível levanta 22023
--   (NL) medida sem ramo no motor levanta erro em vez de devolver NULL mudo
--
-- Run: supabase start && supabase db reset && bash supabase/tests/run.sh
-- Roda inteiro em transação revertida — não muta o banco.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

-- ===========================================================================
-- Fixtures
-- ===========================================================================
INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('3110000a-0000-4000-8000-00000000000a', 'Org SR A', 'org-sr-a', 'America/Sao_Paulo'),
  ('3110000b-0000-4000-8000-00000000000b', 'Org SR B', 'org-sr-b', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tags (id, organization_id, name) VALUES
  ('3110ta9a-0000-4000-8000-00000000000a', '3110000a-0000-4000-8000-00000000000a', 'Ouro')
ON CONFLICT (id) DO NOTHING;

-- Org A: 3 órfãos (2 meta_ads, 1 indicacao), 1 com dono, 1 apagado, 1 sombra.
-- Só os 3 primeiros contam.
INSERT INTO public.leads (id, organization_id, name, origin, deleted_at, is_shadow,
                          responsible_id, sale_responsible_id, pre_sale_responsible_id) VALUES
  ('3110ead1-0000-4000-8000-000000000001', '3110000a-0000-4000-8000-00000000000a', 'Órfão 1', 'meta_ads',  NULL, false, NULL, NULL, NULL),
  ('3110ead1-0000-4000-8000-000000000002', '3110000a-0000-4000-8000-00000000000a', 'Órfão 2', 'meta_ads',  NULL, false, NULL, NULL, NULL),
  ('3110ead1-0000-4000-8000-000000000003', '3110000a-0000-4000-8000-00000000000a', 'Órfão 3', 'indicacao', NULL, false, NULL, NULL, NULL),
  ('3110ead1-0000-4000-8000-000000000004', '3110000a-0000-4000-8000-00000000000a', 'Apagado', 'meta_ads',  now(), false, NULL, NULL, NULL),
  ('3110ead1-0000-4000-8000-000000000005', '3110000a-0000-4000-8000-00000000000a', 'Sombra',  'meta_ads',  NULL, true,  NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- Uma tag no Órfão 1, para o recorte por tag.
INSERT INTO public.lead_tags (lead_id, tag_id) VALUES
  ('3110ead1-0000-4000-8000-000000000001', '3110ta9a-0000-4000-8000-00000000000a')
ON CONFLICT DO NOTHING;

-- Org B: 1 órfão. Existe só para provar que não vaza para a contagem da A.
INSERT INTO public.leads (id, organization_id, name, origin, deleted_at, is_shadow,
                          responsible_id, sale_responsible_id, pre_sale_responsible_id) VALUES
  ('3110ead1-0000-4000-8000-0000000000b1', '3110000b-0000-4000-8000-00000000000b', 'Órfão B', 'meta_ads', NULL, false, NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- ===========================================================================
-- (CT) Catálogo
-- ===========================================================================
SELECT ok(
  EXISTS (SELECT 1 FROM public.metric_catalog_measures WHERE id = 'leads_sem_responsavel'),
  'CT1: medida registrada no catálogo'
);

SELECT is(
  (SELECT anchor FROM public.metric_catalog_measures WHERE id = 'leads_sem_responsavel'),
  'hoje',
  'CT2: âncora é hoje — é estado atual, não contagem de período'
);

SELECT set_eq(
  $$SELECT recorte_id FROM public.metric_catalog_measure_recortes
     WHERE measure_id = 'leads_sem_responsavel'$$,
  ARRAY['total', 'origem', 'tag'],
  'CT3: exatamente os três recortes que fazem sentido'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.metric_catalog_measure_recortes
    WHERE measure_id = 'leads_sem_responsavel' AND recorte_id IN ('closer', 'sdr')
  ),
  'CT4: NÃO aceita corte por pessoa — "sem dono por vendedor" é contradição'
);

-- ===========================================================================
-- (ZE) Zero EXECUTE — o invariante do ADR-0023
-- ===========================================================================
SELECT ok(
  (SELECT prosrc !~* '(^|[^_[:alnum:]])execute[[:space:]]'
     FROM pg_proc WHERE proname = '_metric_leaf_leads_sem_dono'),
  'ZE1: leaf novo não tem EXECUTE dinâmico'
);

SELECT ok(
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=public']
     FROM pg_proc WHERE proname = '_metric_leaf_leads_sem_dono'),
  'ZE2: SECURITY DEFINER com search_path pinado'
);

-- ===========================================================================
-- (GR) Grants — a armadilha das duas metades
-- ===========================================================================
SELECT ok(
  NOT has_function_privilege('anon',
    'public._metric_leaf_leads_sem_dono(uuid, text, jsonb)'::regprocedure, 'EXECUTE'),
  'GR1: anon NÃO executa o leaf interno'
);

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public._metric_leaf_leads_sem_dono(uuid, text, jsonb)'::regprocedure, 'EXECUTE'),
  'GR2: authenticated NÃO executa o leaf interno'
);

SELECT ok(
  has_function_privilege('service_role',
    'public._metric_leaf_leads_sem_dono(uuid, text, jsonb)'::regprocedure, 'EXECUTE'),
  'GR3: service_role executa — senão o motor não roda'
);

-- ===========================================================================
-- (VL) Valor
-- ===========================================================================
SELECT is(
  (public.fn_metric_measure(
     '3110000a-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"leads_sem_responsavel"}'::jsonb,
     'total') ->> 'value')::numeric,
  3::numeric,
  'VL1: conta os 3 órfãos e ignora apagado, sombra e o que tem dono'
);

SELECT is(
  public.fn_metric_measure(
    '3110000a-0000-4000-8000-00000000000a',
    '{"kind":"leaf","id":"leads_sem_responsavel"}'::jsonb,
    'total') ->> 'unit',
  'count',
  'VL2: unidade é contagem'
);

SELECT is(
  public.fn_metric_measure(
    '3110000a-0000-4000-8000-00000000000a',
    '{"kind":"leaf","id":"leads_sem_responsavel"}'::jsonb,
    'total') -> 'series',
  'null'::jsonb,
  'VL3: recorte total devolve escalar, series null (value XOR series)'
);

-- ===========================================================================
-- (XO) Isolamento cross-org
-- ===========================================================================
SELECT is(
  (public.fn_metric_measure(
     '3110000b-0000-4000-8000-00000000000b',
     '{"kind":"leaf","id":"leads_sem_responsavel"}'::jsonb,
     'total') ->> 'value')::numeric,
  1::numeric,
  'XO1: org B vê só o próprio órfão — o da A não vaza'
);

-- ===========================================================================
-- (SR) Séries
-- ===========================================================================
SELECT is(
  jsonb_array_length(
    public.fn_metric_measure(
      '3110000a-0000-4000-8000-00000000000a',
      '{"kind":"leaf","id":"leads_sem_responsavel"}'::jsonb,
      'origem') -> 'series'),
  2,
  'SR1: duas origens distintas entre os órfãos'
);

SELECT is(
  (public.fn_metric_measure(
     '3110000a-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"leads_sem_responsavel"}'::jsonb,
     'origem') -> 'series' -> 0 ->> 'value')::numeric,
  2::numeric,
  'SR2: série ordenada por valor desc — meta_ads (2) vem primeiro'
);

SELECT is(
  (public.fn_metric_measure(
     '3110000a-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"leads_sem_responsavel"}'::jsonb,
     'tag') -> 'series' -> 0 ->> 'value')::numeric,
  1::numeric,
  'SR3: recorte por tag conta só o órfão etiquetado'
);

SELECT is(
  public.fn_metric_measure(
    '3110000a-0000-4000-8000-00000000000a',
    '{"kind":"leaf","id":"leads_sem_responsavel"}'::jsonb,
    'origem') -> 'value',
  'null'::jsonb,
  'SR4: com recorte, value vem null'
);

-- ===========================================================================
-- (RC) Recorte incompatível
-- ===========================================================================
SELECT throws_ok(
  $$SELECT public.fn_metric_measure(
      '3110000a-0000-4000-8000-00000000000a',
      '{"kind":"leaf","id":"leads_sem_responsavel"}'::jsonb,
      'closer')$$,
  '22023',
  NULL,
  'RC1: corte por pessoa levanta 22023, não devolve número errado'
);

-- ===========================================================================
-- (NL) Guarda nova: medida catalogada sem ramo no motor
-- ===========================================================================
-- Antes desta migration o CASE sem ELSE devolvia NULL e o motor entregava
-- value e series nulos SEM erro — número em branco na tela, nada nos logs.
INSERT INTO public.metric_catalog_measures (id, label, unit, anchor, description, sort)
VALUES ('medida_fantasma_311', 'Fantasma', 'count', 'hoje', 'Só existe neste teste.', 999)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.metric_catalog_measure_recortes (measure_id, recorte_id)
VALUES ('medida_fantasma_311', 'total') ON CONFLICT DO NOTHING;

SELECT throws_ok(
  $$SELECT public.fn_metric_measure(
      '3110000a-0000-4000-8000-00000000000a',
      '{"kind":"leaf","id":"medida_fantasma_311"}'::jsonb,
      'total')$$,
  '22023',
  NULL,
  'NL1: medida sem ramo no motor FALHA ALTO em vez de devolver nulo mudo'
);

SELECT * FROM finish();
ROLLBACK;
