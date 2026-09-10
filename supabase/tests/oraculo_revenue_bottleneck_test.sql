-- SCRUM-601 · cálculo determinístico, dinheiro e lastro mínimo.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

SELECT has_function(
  'public', 'oraculo_rank_revenue_bottleneck',
  ARRAY['jsonb', 'integer', 'date', 'jsonb', 'date'],
  '(CONTRATO) calculadora determinística existe'
);
SELECT has_function(
  'public', 'oraculo_revenue_bottleneck', ARRAY['uuid', 'uuid'],
  '(CONTRATO) RPC operacional existe'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.oraculo_revenue_bottleneck(uuid,uuid)', 'EXECUTE'),
  '(SEGURANÇA) organização explícita fica inacessível ao navegador'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.oraculo_revenue_bottleneck_at(uuid,uuid,date)', 'EXECUTE'),
  '(SEGURANÇA) data reproduzível também fica server-only'
);
SELECT ok(
  has_function_privilege('service_role', 'public.oraculo_revenue_bottleneck(uuid,uuid)', 'EXECUTE'),
  '(SEGURANÇA) somente edge autenticada alcança RPC operacional'
);

CREATE TEMP TABLE worked_example AS
SELECT public.oraculo_rank_revenue_bottleneck(
  '[
    {"dimension":"stage","key":"pequena","label":"Etapa pequena","current_volume":4,"baseline_volume":80,"current_successes":1,"baseline_successes":40,"downstream_conversion":0.5,"average_ticket":10000,"min_current":20,"min_baseline":40},
    {"dimension":"stage","key":"grande","label":"Etapa grande","current_volume":300,"baseline_volume":600,"current_successes":48,"baseline_successes":132,"downstream_conversion":0.7,"average_ticket":1000,"min_current":20,"min_baseline":40},
    {"dimension":"product","key":"erp","label":"ERP","current_volume":100,"baseline_volume":200,"current_successes":10,"baseline_successes":30,"downstream_conversion":1,"average_ticket":3000,"min_current":10,"min_baseline":20}
  ]'::jsonb,
  14,
  '2026-09-07',
  '{"open_deals":12,"stalled_14d":3}'::jsonb,
  '2026-09-10'
) AS value;

SELECT is((SELECT value->>'status' FROM worked_example), 'bottleneck', '(DIAGNÓSTICO) existe gargalo com desvio relevante');
SELECT is((SELECT value->'bottleneck'->>'dimension' FROM worked_example), 'product', '(DIMENSÃO) maior impacto vence entre dimensões');
SELECT is((SELECT value->'bottleneck'->>'key' FROM worked_example), 'erp', '(DINHEIRO) ranqueia pela receita vazada estimada');
SELECT is(((SELECT value->'bottleneck'->>'estimated_leaked_revenue' FROM worked_example))::numeric, 15000::numeric, '(CÁLCULO) receita vazada usa unidades perdidas × conversão a jusante × ticket');
SELECT ok(NOT ((SELECT value->'candidates' FROM worked_example) @> '[{"key":"pequena"}]'::jsonb), '(LASTRO) etapa de baixo volume não concorre');

SELECT is(
  public.oraculo_rank_revenue_bottleneck(
    '[{"dimension":"origin","key":"meta","label":"Meta","current_volume":100,"baseline_volume":200,"current_successes":18,"baseline_successes":40,"downstream_conversion":1,"average_ticket":1000,"min_current":20,"min_baseline":40}]'::jsonb,
    14, '2026-09-07', '{}'::jsonb, '2026-09-10'
  )->>'status',
  'none',
  '(SILÊNCIO) variação abaixo de cinco pontos não fabrica gargalo'
);

CREATE TEMP TABLE insufficient AS
SELECT public.oraculo_rank_revenue_bottleneck(
  '[{"dimension":"origin","key":"meta","label":"Meta","current_volume":100,"baseline_volume":200,"current_successes":5,"baseline_successes":40,"downstream_conversion":1,"average_ticket":1000,"min_current":20,"min_baseline":40}]'::jsonb,
  5,
  '2026-11-02',
  '{"open_deals":9,"stalled_14d":2}'::jsonb,
  '2026-09-10'
) AS value;

SELECT is((SELECT value->>'status' FROM insufficient), 'insufficient_evidence', '(LASTRO) organização nova não recebe tendência');
SELECT is((SELECT value->'evidence'->>'available_from' FROM insufficient), '2026-11-02', '(LASTRO) informa quando poderá diagnosticar');
SELECT is((SELECT value->'present'->>'open_deals' FROM insufficient), '9', '(PRESENTE) sem tendência ainda entrega fotografia atual');
SELECT is((SELECT value->>'bottleneck' FROM insufficient), NULL, '(LASTRO) falta de histórico não escolhe candidato');

CREATE TEMP TABLE insufficient_sample AS
SELECT public.oraculo_rank_revenue_bottleneck(
  '[{"dimension":"origin","key":"meta","label":"Meta","current_volume":3,"baseline_volume":7,"current_successes":0,"baseline_successes":4,"downstream_conversion":1,"average_ticket":1000,"min_current":20,"min_baseline":40}]'::jsonb,
  40, '2026-01-01', '{}'::jsonb, '2026-09-10'
) AS value;

SELECT is((SELECT value->>'status' FROM insufficient_sample), 'insufficient_evidence', '(LASTRO) organização antiga com amostra pequena não recebe falso nenhum gargalo');
SELECT is((SELECT value->'evidence'->>'reason' FROM insufficient_sample), 'sample_size', '(LASTRO) distingue falta de amostra de falta de histórico');
SELECT is((SELECT value->'evidence'->>'available_from' FROM insufficient_sample), NULL, '(LASTRO) volume imprevisível não promete data vencida');
SELECT ok((SELECT value->'evidence'->'missing_dimensions' @> '[{"dimension":"origin"}]'::jsonb FROM insufficient_sample), '(LASTRO) informa dimensão sem amostra mínima');

SELECT is(
  public.oraculo_rank_revenue_bottleneck(
    (SELECT '[{"dimension":"origin","key":"meta","label":"Meta","current_volume":100,"baseline_volume":200,"current_successes":5,"baseline_successes":40,"downstream_conversion":1,"average_ticket":1000,"min_current":20,"min_baseline":40}]'::jsonb),
    14, '2026-09-07', '{}'::jsonb, '2026-09-10'
  ),
  public.oraculo_rank_revenue_bottleneck(
    (SELECT '[{"dimension":"origin","key":"meta","label":"Meta","current_volume":100,"baseline_volume":200,"current_successes":5,"baseline_successes":40,"downstream_conversion":1,"average_ticket":1000,"min_current":20,"min_baseline":40}]'::jsonb),
    14, '2026-09-07', '{}'::jsonb, '2026-09-10'
  ),
  '(DETERMINISMO) mesma entrada produz exatamente a mesma saída'
);

-- O seam operacional lê os fatos canônicos. O cenário cria três populações:
-- pessoa consultada, colega da mesma organização e organização vizinha. A
-- vizinha tem vazamento maior de propósito; se o tenant escapar, ela vence.
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('a6010000-0000-4000-8000-000000000001', 'Org Gargalo', 'org-gargalo-t', 'America/Sao_Paulo'),
  ('a6010000-0000-4000-8000-000000000002', 'Org Vizinha Gargalo', 'org-vizinha-gargalo-t', 'America/Sao_Paulo'),
  ('a6010000-0000-4000-8000-000000000003', 'Org Nova Gargalo', 'org-nova-gargalo-t', 'America/Sao_Paulo'),
  ('a6010000-0000-4000-8000-000000000004', 'Org Etapas Gargalo', 'org-etapas-gargalo-t', 'America/Sao_Paulo'),
  ('a6010000-0000-4000-8000-000000000005', 'Org Produtos Gargalo', 'org-produtos-gargalo-t', 'America/Sao_Paulo'),
  ('a6010000-0000-4000-8000-000000000006', 'Org Fuso Gargalo', 'org-fuso-gargalo-t', 'America/Sao_Paulo');

INSERT INTO auth.users (id, email) VALUES
  ('a6010000-0000-4000-8000-0000000000a1', 'ana-gargalo@test.local'),
  ('a6010000-0000-4000-8000-0000000000a2', 'bia-gargalo@test.local'),
  ('a6010000-0000-4000-8000-0000000000a3', 'vizinha-gargalo@test.local');

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('a6010000-0000-4000-8000-0000000000b1', 'a6010000-0000-4000-8000-000000000001', 'a6010000-0000-4000-8000-0000000000a1', 'Ana', 'member', true),
  ('a6010000-0000-4000-8000-0000000000b2', 'a6010000-0000-4000-8000-000000000001', 'a6010000-0000-4000-8000-0000000000a2', 'Bia', 'member', true),
  ('a6010000-0000-4000-8000-0000000000b3', 'a6010000-0000-4000-8000-000000000002', 'a6010000-0000-4000-8000-0000000000a3', 'Vizinha', 'member', true);

CREATE TEMP TABLE revenue_fixture (
  population text NOT NULL,
  sequence integer NOT NULL,
  lead_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  member_id uuid NOT NULL,
  cohort_at timestamptz NOT NULL,
  won boolean NOT NULL,
  ticket numeric NOT NULL
);

INSERT INTO revenue_fixture
SELECT 'own_baseline', n, md5('own-baseline-' || n)::uuid,
  'a6010000-0000-4000-8000-000000000001'::uuid, 'a6010000-0000-4000-8000-0000000000b1'::uuid,
  '2026-06-02'::timestamptz + (n % 40) * interval '1 day', n <= 20, 1000
FROM generate_series(1, 100) n
UNION ALL
SELECT 'own_current', n, md5('own-current-' || n)::uuid,
  'a6010000-0000-4000-8000-000000000001'::uuid, 'a6010000-0000-4000-8000-0000000000b1'::uuid,
  '2026-07-28'::timestamptz + (n % 20) * interval '1 day', n <= 5, 1000
FROM generate_series(1, 50) n
UNION ALL
SELECT 'peer_baseline', n, md5('peer-baseline-' || n)::uuid,
  'a6010000-0000-4000-8000-000000000001'::uuid, 'a6010000-0000-4000-8000-0000000000b2'::uuid,
  '2026-06-02'::timestamptz + (n % 40) * interval '1 day', n <= 40, 10000
FROM generate_series(1, 100) n
UNION ALL
SELECT 'peer_current', n, md5('peer-current-' || n)::uuid,
  'a6010000-0000-4000-8000-000000000001'::uuid, 'a6010000-0000-4000-8000-0000000000b2'::uuid,
  '2026-07-28'::timestamptz + (n % 20) * interval '1 day', false, 10000
FROM generate_series(1, 50) n
UNION ALL
SELECT 'foreign_baseline', n, md5('foreign-baseline-' || n)::uuid,
  'a6010000-0000-4000-8000-000000000002'::uuid, 'a6010000-0000-4000-8000-0000000000b3'::uuid,
  '2026-06-02'::timestamptz + (n % 40) * interval '1 day', n <= 50, 50000
FROM generate_series(1, 100) n
UNION ALL
SELECT 'foreign_current', n, md5('foreign-current-' || n)::uuid,
  'a6010000-0000-4000-8000-000000000002'::uuid, 'a6010000-0000-4000-8000-0000000000b3'::uuid,
  '2026-07-28'::timestamptz + (n % 20) * interval '1 day', false, 50000
FROM generate_series(1, 50) n;

INSERT INTO public.leads (id, organization_id, name, origin, responsible_id, created_at)
SELECT lead_id, organization_id, population || '-' || sequence, 'meta_ads', member_id, cohort_at
FROM revenue_fixture WHERE population LIKE 'own_%' OR population LIKE 'foreign_%';

INSERT INTO public.leads (id, organization_id, name, origin, responsible_id, created_at)
SELECT lead_id, organization_id, population || '-' || sequence, 'whatsapp', member_id, cohort_at
FROM revenue_fixture WHERE population LIKE 'peer_%';

INSERT INTO public.leads (id, organization_id, name, origin, created_at) VALUES
  ('a6010000-0000-4000-8000-0000000000d1', 'a6010000-0000-4000-8000-000000000003', 'Primeiro lead', 'meta_ads', '2026-09-09');

INSERT INTO public.conversation_summaries (
  id, organization_id, lead_id, summary, next_action
) VALUES (
  'a6010000-0000-4000-8000-0000000000e1', 'a6010000-0000-4000-8000-000000000003',
  'a6010000-0000-4000-8000-0000000000d1', 'Primeiro contato em andamento.', NULL
);

INSERT INTO public.sale_events (
  id, organization_id, lead_id, event_type, sold_at, sale_value,
  sale_responsible_id, source, producer, origin_record_id, currency, revenue_stream
)
SELECT md5('sale-' || lead_id::text)::uuid, organization_id, lead_id, 'sale',
  cohort_at + interval '1 day', ticket, member_id, 'backfill', 'carteira',
  lead_id, 'BRL', 'carteira'
FROM revenue_fixture WHERE won;

-- A função `_at` reconstrói o que era sabido na data pedida. Um estorno
-- posterior não pode reescrever retrospectivamente o benchmark.
INSERT INTO public.sale_events (
  id, organization_id, lead_id, event_type, sold_at, sale_value,
  sale_responsible_id, reversed_event_id, source, producer,
  origin_record_id, currency, revenue_stream
)
SELECT md5('reversal-' || lead_id::text)::uuid, organization_id, lead_id,
  'sale_reversed', '2026-09-09', ticket, member_id,
  md5('sale-' || lead_id::text)::uuid, 'backfill', 'carteira', lead_id,
  'BRL', 'carteira'
FROM revenue_fixture
WHERE population = 'own_baseline' AND sequence = 1;

-- Etapa: identidade é `entry_id`, porque um Lead pode ter vários Negócios.
INSERT INTO public.pipelines (id, organization_id, name, slug, type) VALUES
  ('a6010000-0000-4000-8000-0000000000c4', 'a6010000-0000-4000-8000-000000000004', 'Funil Etapas', 'whatsapp', 'system');

INSERT INTO public.pipeline_stages (
  id, organization_id, pipeline_id, pipeline_type, stage_key, name, stage_role
) VALUES
  ('a6010000-0000-4000-8000-0000000000d4', 'a6010000-0000-4000-8000-000000000004', 'a6010000-0000-4000-8000-0000000000c4', 'whatsapp', 'qualificacao', 'Qualificação', 'open'),
  ('a6010000-0000-4000-8000-0000000000d5', 'a6010000-0000-4000-8000-000000000004', 'a6010000-0000-4000-8000-0000000000c4', 'whatsapp', 'proposta', 'Proposta', 'open'),
  ('a6010000-0000-4000-8000-0000000000d6', 'a6010000-0000-4000-8000-000000000004', 'a6010000-0000-4000-8000-0000000000c4', 'whatsapp', 'won', 'Ganho', 'won');

CREATE TEMP TABLE stage_fixture AS
SELECT 'baseline'::text AS period, n AS sequence,
  md5('stage-baseline-lead-' || n)::uuid AS lead_id,
  md5('stage-baseline-entry-' || n)::uuid AS entry_id,
  '2026-06-02'::timestamptz + (n % 40) * interval '1 day' AS arrived_at,
  n <= 20 AS progressed, n <= 10 AS won
FROM generate_series(1, 40) n
UNION ALL
SELECT 'current', n, md5('stage-current-lead-' || n)::uuid,
  md5('stage-current-entry-' || n)::uuid,
  '2026-07-28'::timestamptz + (n % 20) * interval '1 day',
  n <= 4, false
FROM generate_series(1, 20) n;

INSERT INTO public.leads (id, organization_id, name, origin, created_at)
SELECT lead_id, 'a6010000-0000-4000-8000-000000000004', 'Etapa-' || period || '-' || sequence,
  'outro', '2025-01-01'
FROM stage_fixture;

INSERT INTO public.pipeline_stage_events (
  id, organization_id, lead_id, pipeline_id, entry_id,
  from_stage_key, to_stage_key, occurred_at, source
)
SELECT md5('stage-arrival-' || entry_id::text)::uuid,
  'a6010000-0000-4000-8000-000000000004', lead_id,
  'a6010000-0000-4000-8000-0000000000c4', entry_id,
  'novo', 'qualificacao', arrived_at, 'backfill'
FROM stage_fixture;

INSERT INTO public.pipeline_stage_events (
  id, organization_id, lead_id, pipeline_id, entry_id,
  from_stage_key, to_stage_key, occurred_at, source
)
SELECT md5('stage-progress-' || entry_id::text)::uuid,
  'a6010000-0000-4000-8000-000000000004', lead_id,
  'a6010000-0000-4000-8000-0000000000c4', entry_id,
  'qualificacao', CASE WHEN won THEN 'won' ELSE 'proposta' END,
  arrived_at + interval '1 day', 'backfill'
FROM stage_fixture WHERE progressed;

INSERT INTO public.sale_events (
  id, organization_id, lead_id, pipeline_id, stage_key, stage_event_id,
  event_type, sold_at, sale_value, source, producer, currency, revenue_stream
)
SELECT md5('stage-sale-' || entry_id::text)::uuid,
  'a6010000-0000-4000-8000-000000000004', lead_id,
  'a6010000-0000-4000-8000-0000000000c4', 'won',
  md5('stage-progress-' || entry_id::text)::uuid, 'sale',
  arrived_at + interval '1 day', 1000, 'backfill', 'funnel', 'BRL', 'novo_negocio'
FROM stage_fixture WHERE won;

-- Evento e venda de OUTRO Negócio do mesmo Lead. Não podem converter a
-- chegada de sequence=5, que segue parada.
INSERT INTO public.pipeline_stage_events (
  id, organization_id, lead_id, pipeline_id, entry_id,
  from_stage_key, to_stage_key, occurred_at, source
)
SELECT 'a6010000-0000-4000-8000-0000000000e4',
  'a6010000-0000-4000-8000-000000000004', lead_id,
  'a6010000-0000-4000-8000-0000000000c4',
  'a6010000-0000-4000-8000-0000000000f4',
  'qualificacao', 'won', arrived_at + interval '1 day', 'backfill'
FROM stage_fixture WHERE period = 'current' AND sequence = 5;

INSERT INTO public.sale_events (
  id, organization_id, lead_id, pipeline_id, stage_key, stage_event_id,
  event_type, sold_at, sale_value, source, producer, currency, revenue_stream
)
SELECT 'a6010000-0000-4000-8000-0000000000e5',
  'a6010000-0000-4000-8000-000000000004', lead_id,
  'a6010000-0000-4000-8000-0000000000c4', 'won',
  'a6010000-0000-4000-8000-0000000000e4', 'sale',
  arrived_at + interval '1 day', 50000, 'backfill', 'funnel', 'BRL', 'novo_negocio'
FROM stage_fixture WHERE period = 'current' AND sequence = 5;

-- Venda registrada depois do corte histórico. Mesmo pertencendo à entry_id,
-- não pode alterar ticket nem diagnóstico de 2026-09-10.
INSERT INTO public.pipeline_stage_events (
  id, organization_id, lead_id, pipeline_id, entry_id,
  from_stage_key, to_stage_key, occurred_at, source
)
SELECT 'a6010000-0000-4000-8000-0000000000e6',
  'a6010000-0000-4000-8000-000000000004', lead_id,
  'a6010000-0000-4000-8000-0000000000c4', entry_id,
  'qualificacao', 'won', arrived_at + interval '30 days', 'backfill'
FROM stage_fixture WHERE period = 'current' AND sequence = 19;

INSERT INTO public.sale_events (
  id, organization_id, lead_id, pipeline_id, stage_key, stage_event_id,
  event_type, sold_at, sale_value, source, producer, currency, revenue_stream
)
SELECT 'a6010000-0000-4000-8000-0000000000e7',
  'a6010000-0000-4000-8000-000000000004', lead_id,
  'a6010000-0000-4000-8000-0000000000c4', 'won',
  'a6010000-0000-4000-8000-0000000000e6', 'sale',
  arrived_at + interval '30 days', 50000, 'backfill', 'funnel', 'BRL', 'novo_negocio'
FROM stage_fixture WHERE period = 'current' AND sequence = 19;

-- Produto: venda de pacote é rateada pelo valor dos itens. Ticket integral em
-- cada produto duplicaria receita e faria item barato parecer gargalo líder.
INSERT INTO public.products (id, organization_id, name, type) VALUES
  ('a6010000-0000-4000-8000-000000000051', 'a6010000-0000-4000-8000-000000000005', 'Produto barato', 'unitario'),
  ('a6010000-0000-4000-8000-000000000052', 'a6010000-0000-4000-8000-000000000005', 'Produto principal', 'unitario');

CREATE TEMP TABLE product_fixture AS
SELECT 'baseline'::text AS period, n AS sequence,
  md5('product-baseline-lead-' || n)::uuid AS lead_id,
  md5('product-baseline-deal-' || n)::uuid AS deal_id,
  '2026-06-02'::timestamptz + (n % 20) * interval '1 day' AS created_at,
  n <= 10 AS won
FROM generate_series(1, 20) n
UNION ALL
SELECT 'current', n, md5('product-current-lead-' || n)::uuid,
  md5('product-current-deal-' || n)::uuid,
  '2026-07-28'::timestamptz + (n % 10) * interval '1 day',
  n <= 1
FROM generate_series(1, 10) n;

INSERT INTO public.leads (id, organization_id, name, origin, created_at)
SELECT lead_id, 'a6010000-0000-4000-8000-000000000005', 'Produto-' || period || '-' || sequence,
  'outro', '2025-01-01'
FROM product_fixture;

INSERT INTO public.deals (id, organization_id, title, source_lead_id, created_at)
SELECT deal_id, 'a6010000-0000-4000-8000-000000000005', 'Pacote-' || period || '-' || sequence,
  lead_id, created_at
FROM product_fixture;

INSERT INTO public.deal_items (
  id, organization_id, deal_id, product_id, product_name, quantity, unit_price
)
SELECT md5('cheap-item-' || deal_id::text)::uuid,
  'a6010000-0000-4000-8000-000000000005'::uuid, deal_id,
  'a6010000-0000-4000-8000-000000000051'::uuid, 'Produto barato', 1, 100
FROM product_fixture
UNION ALL
SELECT md5('main-item-' || deal_id::text)::uuid,
  'a6010000-0000-4000-8000-000000000005'::uuid, deal_id,
  'a6010000-0000-4000-8000-000000000052'::uuid, 'Produto principal', 1, 9900
FROM product_fixture;

INSERT INTO public.sale_events (
  id, organization_id, lead_id, deal_id, event_type, sold_at, sale_value,
  source, producer, origin_record_id, currency, revenue_stream
)
SELECT md5('product-sale-' || deal_id::text)::uuid,
  'a6010000-0000-4000-8000-000000000005', lead_id, deal_id, 'sale',
  created_at + interval '1 day', 10000, 'backfill', 'carteira', deal_id,
  'BRL', 'carteira'
FROM product_fixture WHERE won;

-- Limite UTC 02:30 de segunda ainda pertence ao domingo em São Paulo.
CREATE TEMP TABLE timezone_fixture AS
SELECT 'baseline'::text AS period, n AS sequence,
  md5('timezone-baseline-' || n)::uuid AS lead_id,
  '2026-06-02 12:00:00+00'::timestamptz + (n % 40) * interval '1 day' AS cohort_at,
  n <= 8 AS won
FROM generate_series(1, 40) n
UNION ALL
SELECT 'current', n, md5('timezone-current-' || n)::uuid,
  '2026-07-28 12:00:00+00'::timestamptz + (n % 20) * interval '1 day',
  n <= 2
FROM generate_series(1, 20) n
UNION ALL
SELECT 'boundary', 1, 'a6010000-0000-4000-8000-000000000061',
  '2026-07-27 02:30:00+00', true
UNION ALL
SELECT 'first_fact_boundary', 1, 'a6010000-0000-4000-8000-000000000062',
  '2026-06-01 02:30:00+00', false;

INSERT INTO public.leads (id, organization_id, name, origin, created_at)
SELECT lead_id, 'a6010000-0000-4000-8000-000000000006', 'Fuso-' || period || '-' || sequence,
  'meta_ads', cohort_at
FROM timezone_fixture;

INSERT INTO public.sale_events (
  id, organization_id, lead_id, event_type, sold_at, sale_value,
  source, producer, origin_record_id, currency, revenue_stream
)
SELECT md5('timezone-sale-' || lead_id::text)::uuid,
  'a6010000-0000-4000-8000-000000000006', lead_id, 'sale',
  cohort_at + interval '1 hour', 1000, 'backfill', 'carteira', lead_id,
  'BRL', 'carteira'
FROM timezone_fixture WHERE won;

SET LOCAL session_replication_role = origin;

CREATE TEMP TABLE member_result AS
SELECT public.oraculo_revenue_bottleneck_at(
  'a6010000-0000-4000-8000-000000000001',
  'a6010000-0000-4000-8000-0000000000b1',
  '2026-09-10'
) AS value;

SELECT is((SELECT value->>'status' FROM member_result), 'bottleneck', '(RPC) fatos canônicos produzem diagnóstico');
SELECT is((SELECT value->'bottleneck'->>'key' FROM member_result), 'meta_ads', '(ESCOPO) pessoa vê somente carteira atribuída');
SELECT is(((SELECT value->'bottleneck'->>'estimated_leaked_revenue' FROM member_result))::numeric, 5000::numeric, '(RPC) dinheiro usa conversão histórica e ticket canônicos');
SELECT is(((SELECT value->'evidence'->>'available_weeks' FROM member_result))::integer, 14, '(LASTRO) RPC mede semanas disponíveis nos fatos');

CREATE TEMP TABLE org_result AS
SELECT public.oraculo_revenue_bottleneck_at(
  'a6010000-0000-4000-8000-000000000001', NULL, '2026-09-10'
) AS value;

SELECT is((SELECT value->'bottleneck'->>'key' FROM org_result), 'whatsapp', '(ESCOPO) organização inclui colega autorizado');
SELECT is(((SELECT value->'bottleneck'->>'estimated_leaked_revenue' FROM org_result))::numeric, 200000::numeric, '(ISOLAMENTO) organização vizinha com perda maior não contamina ranking');
SELECT is(
  (SELECT value FROM member_result),
  public.oraculo_revenue_bottleneck_at(
    'a6010000-0000-4000-8000-000000000001',
    'a6010000-0000-4000-8000-0000000000b1',
    '2026-09-10'
  ),
  '(DETERMINISMO) RPC ancorada repete inclusive fotografia presente'
);

CREATE TEMP TABLE new_org_result AS
SELECT public.oraculo_revenue_bottleneck_at(
  'a6010000-0000-4000-8000-000000000003', NULL, '2026-09-10'
) AS value;

SELECT is((SELECT value->>'status' FROM new_org_result), 'insufficient_evidence', '(ORG NOVA) pouco histórico não vira tendência');
SELECT is((SELECT value->'bottleneck' FROM new_org_result), 'null'::jsonb, '(ORG NOVA) nenhum gargalo é fabricado');
SELECT is(((SELECT value->'present'->>'conversations_without_next_step' FROM new_org_result))::integer, 1, '(ORG NOVA) fotografia presente continua útil');
SELECT is((SELECT value->'evidence'->>'available_from' FROM new_org_result), '2026-12-14', '(ORG NOVA) informa primeira semana elegível');

CREATE TEMP TABLE stage_result AS
SELECT public.oraculo_revenue_bottleneck_at(
  'a6010000-0000-4000-8000-000000000004', NULL, '2026-09-10'
) AS value;

SELECT is((SELECT value->'bottleneck'->>'dimension' FROM stage_result), 'stage', '(ETAPA) extração operacional diagnostica dimensão etapa');
SELECT is(((SELECT value->'bottleneck'->>'current_conversion' FROM stage_result))::numeric, 0.2::numeric, '(ETAPA) outro Negócio do mesmo Lead não fabrica progresso');
SELECT is(((SELECT value->'bottleneck'->>'downstream_conversion' FROM stage_result))::numeric, 0.5::numeric, '(ETAPA) venda a jusante pertence à mesma entry_id');
SELECT is(((SELECT value->'bottleneck'->>'estimated_leaked_revenue' FROM stage_result))::numeric, 3000::numeric, '(ETAPA) vazamento combina perda, conversão a jusante e ticket sem mistura');

CREATE TEMP TABLE product_result AS
SELECT public.oraculo_revenue_bottleneck_at(
  'a6010000-0000-4000-8000-000000000005', NULL, '2026-09-10'
) AS value;

SELECT is((SELECT value->'bottleneck'->>'dimension' FROM product_result), 'product', '(PRODUTO) extração operacional diagnostica dimensão produto');
SELECT is((SELECT value->'bottleneck'->>'key' FROM product_result), 'a6010000-0000-4000-8000-000000000052', '(PRODUTO) maior parcela monetária do pacote vence');
SELECT is(((SELECT value->'bottleneck'->>'average_ticket' FROM product_result))::numeric, 9900::numeric, '(PRODUTO) ticket é rateado pelo valor dos itens');
SELECT is(((SELECT value->'bottleneck'->>'estimated_leaked_revenue' FROM product_result))::numeric, 39600::numeric, '(PRODUTO) pacote não duplica receita entre itens');

CREATE TEMP TABLE timezone_result AS
SELECT public.oraculo_revenue_bottleneck_at(
  'a6010000-0000-4000-8000-000000000006', NULL, '2026-09-10'
) AS value;

SELECT is(((SELECT value->'bottleneck'->>'baseline_volume' FROM timezone_result))::integer, 41, '(FUSO) domingo 23:30 BRT permanece na baseline local');
SELECT is(((SELECT value->'bottleneck'->>'current_volume' FROM timezone_result))::integer, 20, '(FUSO) fronteira UTC não invade semana atual');
SELECT is(((SELECT value->'bottleneck'->>'estimated_leaked_revenue' FROM timezone_result))::numeric, 2390.24::numeric, '(FUSO) receita vazada usa cortes da organização');
SELECT is(((SELECT value->'evidence'->>'available_weeks' FROM timezone_result))::integer, 15, '(FUSO) primeiro fato usa semana local para medir lastro');
SELECT is((SELECT value->'evidence'->>'available_from' FROM timezone_result), NULL, '(FUSO) lastro já completo não devolve data vencida');

SELECT * FROM finish();
ROLLBACK;
