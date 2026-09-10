BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

SELECT has_table(
  'public',
  'oraculo_benchmark_weekly',
  '(CONTRATO) snapshot semanal materializado existe'
);

SELECT has_function(
  'public',
  'oraculo_benchmark',
  ARRAY['uuid'],
  '(CONTRATO) leitor agregado existe'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.oraculo_benchmark_weekly', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.oraculo_benchmark_weekly', 'SELECT'),
  '(PRIVACIDADE) navegador não lê snapshots de outras organizações'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.oraculo_benchmark(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.oraculo_benchmark(uuid)', 'EXECUTE'),
  '(PRIVACIDADE) leitor agregado é server-only'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated', 'public.refresh_oraculo_benchmark_weekly(date)', 'EXECUTE'
  ),
  '(PRIVACIDADE) cliente não dispara rematerialização'
);

SELECT is(
  public.oraculo_benchmark_week_is_closed(
    '2026-09-07', '2026-09-07 09:15:00+00', 'Pacific/Honolulu'
  ),
  false,
  '(FUSO) 09:15 UTC ainda não fechou a semana no Havaí'
);

SELECT is(
  public.oraculo_benchmark_week_is_closed(
    '2026-09-07', '2026-09-07 13:15:00+00', 'Pacific/Honolulu'
  ),
  true,
  '(FUSO) cron roda somente depois da virada em UTC-10'
);

INSERT INTO public.organizations (
  id, name, slug, subscription_status, is_sandbox, timezone
) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'Leitora', 'bench-leitora', 'active', false, 'America/Sao_Paulo'),
  ('b0000000-0000-0000-0000-000000000101', 'Par 1', 'bench-par-1', 'active', false, 'America/Sao_Paulo'),
  ('b0000000-0000-0000-0000-000000000102', 'Par 2', 'bench-par-2', 'active', false, 'America/Sao_Paulo'),
  ('b0000000-0000-0000-0000-000000000103', 'Par 3', 'bench-par-3', 'active', false, 'America/Sao_Paulo'),
  ('b0000000-0000-0000-0000-000000000104', 'Par 4', 'bench-par-4', 'active', false, 'America/Sao_Paulo'),
  ('b0000000-0000-0000-0000-000000000105', 'Par 5', 'bench-par-5', 'trial', false, 'America/Sao_Paulo'),
  ('b0000000-0000-0000-0000-000000000201', 'Inerte', 'bench-inerte', 'active', false, 'America/Sao_Paulo'),
  ('b0000000-0000-0000-0000-000000000202', 'Sandbox', 'bench-sandbox', 'active', true, 'America/Sao_Paulo'),
  ('b0000000-0000-0000-0000-000000000203', 'Suspensa', 'bench-suspensa', 'suspended', false, 'America/Sao_Paulo');

SELECT is(
  public.oraculo_benchmark('b0000000-0000-0000-0000-000000000001'::uuid)
    #>> '{self_benchmark,available}',
  'true',
  '(INICIALIZAÇÃO) organização nova recebe auto-benchmark antes do primeiro cron'
);

SELECT is(
  public.oraculo_benchmark('b0000000-0000-0000-0000-000000000001'::uuid)
    #>> '{external_benchmark,reason}',
  'snapshot_pending',
  '(INICIALIZAÇÃO) externo pendente fica explícito e sem estimativa'
);

INSERT INTO public.team_members (id, name, role, organization_id, is_active)
SELECT
  ('c' || substr(replace(o.id::text, '-', ''), 2))::uuid,
  'Gestor ' || o.slug,
  'admin',
  o.id,
  true
FROM public.organizations o
WHERE o.slug LIKE 'bench-%';

WITH volumes(organization_id, current_count, baseline_count) AS (
  VALUES
    ('b0000000-0000-0000-0000-000000000001'::uuid, 100, 40),
    ('b0000000-0000-0000-0000-000000000101'::uuid, 20, 40),
    ('b0000000-0000-0000-0000-000000000102'::uuid, 30, 40),
    ('b0000000-0000-0000-0000-000000000103'::uuid, 40, 40),
    ('b0000000-0000-0000-0000-000000000104'::uuid, 50, 40),
    ('b0000000-0000-0000-0000-000000000105'::uuid, 60, 40),
    ('b0000000-0000-0000-0000-000000000201'::uuid, 500, 40),
    ('b0000000-0000-0000-0000-000000000202'::uuid, 700, 40),
    ('b0000000-0000-0000-0000-000000000203'::uuid, 900, 40)
), generated AS (
  SELECT organization_id, 'current'::text AS period, n
  FROM volumes CROSS JOIN LATERAL generate_series(1, current_count) n
  UNION ALL
  SELECT organization_id, 'baseline', n
  FROM volumes CROSS JOIN LATERAL generate_series(1, baseline_count) n
)
INSERT INTO public.leads (id, organization_id, name, created_at, metrics_period_at)
SELECT
  md5(organization_id::text || ':' || period || ':' || n)::uuid,
  organization_id,
  'Lead ' || period || ' ' || n,
  CASE period WHEN 'current' THEN '2026-08-20 15:00:00+00'::timestamptz
              ELSE '2026-07-20 15:00:00+00'::timestamptz END,
  CASE period WHEN 'current' THEN '2026-08-20 15:00:00+00'::timestamptz
              ELSE '2026-07-20 15:00:00+00'::timestamptz END
FROM generated;

-- Vendas pertencem à mesma coorte do Lead e têm 14 dias para converter.
-- O ticket dos cinco pares forma [100, 200, 300, 400, 500].
WITH tickets(organization_id, ticket) AS (
  VALUES
    ('b0000000-0000-0000-0000-000000000001'::uuid, 100::numeric),
    ('b0000000-0000-0000-0000-000000000101'::uuid, 100::numeric),
    ('b0000000-0000-0000-0000-000000000102'::uuid, 200::numeric),
    ('b0000000-0000-0000-0000-000000000103'::uuid, 300::numeric),
    ('b0000000-0000-0000-0000-000000000104'::uuid, 400::numeric),
    ('b0000000-0000-0000-0000-000000000105'::uuid, 500::numeric)
), chosen AS (
  SELECT t.organization_id, t.ticket, min(l.id::text)::uuid AS lead_id
  FROM tickets t
  JOIN public.leads l ON l.organization_id = t.organization_id
  WHERE l.metrics_period_at = '2026-08-20 15:00:00+00'::timestamptz
  GROUP BY t.organization_id, t.ticket
)
INSERT INTO public.sale_events (
  id, organization_id, lead_id, event_type, sold_at, sale_value,
  source, producer, origin_record_id, currency, revenue_stream
)
SELECT
  md5('current-sale:' || organization_id::text)::uuid,
  organization_id,
  lead_id,
  'sale',
  '2026-08-21 15:00:00+00',
  ticket,
  'backfill',
  'carteira',
  md5('current-origin:' || organization_id::text)::uuid,
  'BRL',
  'novo_negocio'
FROM chosen;

-- Segunda venda do mesmo Lead: entra no ticket, mas conversão conta o Lead uma vez.
INSERT INTO public.sale_events (
  id, organization_id, lead_id, event_type, sold_at, sale_value,
  source, producer, origin_record_id, currency, revenue_stream
)
SELECT
  'b6020000-0000-4000-8000-000000000001',
  l.organization_id,
  min(l.id::text)::uuid,
  'sale',
  '2026-08-22 15:00:00+00',
  200,
  'backfill',
  'carteira',
  'b6020000-0000-4000-8000-000000000002',
  'BRL',
  'carteira'
FROM public.leads l
WHERE l.organization_id = 'b0000000-0000-0000-0000-000000000001'::uuid
  AND l.metrics_period_at = '2026-08-20 15:00:00+00'::timestamptz
GROUP BY l.organization_id;

-- Outra conversão, estornada depois da maturação mas antes do snapshot.
-- O estorno conhecido anula a venda na leitura canônica.
WITH ranked AS (
  SELECT l.*, row_number() OVER (ORDER BY l.id) AS position
  FROM public.leads l
  WHERE l.organization_id = 'b0000000-0000-0000-0000-000000000001'::uuid
    AND l.metrics_period_at = '2026-08-20 15:00:00+00'::timestamptz
)
INSERT INTO public.sale_events (
  id, organization_id, lead_id, event_type, sold_at, sale_value,
  source, producer, origin_record_id, currency, revenue_stream
)
SELECT
  'b6020000-0000-4000-8000-000000000010',
  organization_id,
  id,
  'sale',
  '2026-08-21 16:00:00+00',
  400,
  'backfill',
  'carteira',
  'b6020000-0000-4000-8000-000000000012',
  'BRL',
  'novo_negocio'
FROM ranked WHERE position = 2;

INSERT INTO public.sale_events (
  id, organization_id, lead_id, event_type, reversed_event_id,
  sold_at, sale_value, source, producer, origin_record_id, currency, revenue_stream
)
SELECT
  'b6020000-0000-4000-8000-000000000011',
  organization_id,
  lead_id,
  'sale_reversed',
  id,
  '2026-09-04 15:00:00+00',
  sale_value,
  'backfill',
  'carteira',
  'b6020000-0000-4000-8000-000000000013',
  'BRL',
  revenue_stream
FROM public.sale_events
WHERE id = 'b6020000-0000-4000-8000-000000000010';

-- Estorno depois do corte não reescreve o que era conhecido no snapshot.
INSERT INTO public.sale_events (
  id, organization_id, lead_id, event_type, reversed_event_id,
  sold_at, sale_value, source, producer, origin_record_id, currency, revenue_stream
)
SELECT
  'b6020000-0000-4000-8000-000000000014',
  organization_id,
  lead_id,
  'sale_reversed',
  id,
  '2026-09-08 15:00:00+00',
  sale_value,
  'backfill',
  'carteira',
  'b6020000-0000-4000-8000-000000000015',
  'BRL',
  revenue_stream
FROM public.sale_events
WHERE id = 'b6020000-0000-4000-8000-000000000001';

-- Venda depois da maturação fixa não reabre a coorte retrospectivamente.
INSERT INTO public.sale_events (
  id, organization_id, lead_id, event_type, sold_at, sale_value,
  source, producer, origin_record_id, currency, revenue_stream
)
SELECT
  'b6020000-0000-4000-8000-000000000008',
  l.organization_id,
  min(l.id::text)::uuid,
  'sale',
  '2026-09-05 15:00:00+00',
  5000,
  'backfill',
  'carteira',
  'b6020000-0000-4000-8000-000000000009',
  'BRL',
  'carteira'
FROM public.leads l
WHERE l.organization_id = 'b0000000-0000-0000-0000-000000000001'::uuid
  AND l.metrics_period_at = '2026-08-20 15:00:00+00'::timestamptz
GROUP BY l.organization_id;

-- Venda recente de Lead antigo não pertence à coorte e não infla conversão.
INSERT INTO public.leads (
  id, organization_id, name, created_at, metrics_period_at
) VALUES (
  'b6020000-0000-4000-8000-000000000003',
  'b0000000-0000-0000-0000-000000000001',
  'Lead antigo',
  '2026-01-01 15:00:00+00',
  '2026-01-01 15:00:00+00'
);
INSERT INTO public.sale_events (
  id, organization_id, lead_id, event_type, sold_at, sale_value,
  source, producer, origin_record_id, currency, revenue_stream
) VALUES (
  'b6020000-0000-4000-8000-000000000004',
  'b0000000-0000-0000-0000-000000000001',
  'b6020000-0000-4000-8000-000000000003',
  'sale',
  '2026-08-21 15:00:00+00',
  9999,
  'backfill',
  'carteira',
  'b6020000-0000-4000-8000-000000000005',
  'BRL',
  'carteira'
);

-- Baseline da leitora: uma conversão e ticket R$50.
INSERT INTO public.sale_events (
  id, organization_id, lead_id, event_type, sold_at, sale_value,
  source, producer, origin_record_id, currency, revenue_stream
)
SELECT
  'b6020000-0000-4000-8000-000000000006',
  l.organization_id,
  min(l.id::text)::uuid,
  'sale',
  '2026-07-21 15:00:00+00',
  50,
  'backfill',
  'carteira',
  'b6020000-0000-4000-8000-000000000007',
  'BRL',
  'novo_negocio'
FROM public.leads l
WHERE l.organization_id = 'b0000000-0000-0000-0000-000000000001'::uuid
  AND l.metrics_period_at = '2026-07-20 15:00:00+00'::timestamptz
GROUP BY l.organization_id;

-- Toda org, exceto a inerte, mostra atividade humana. Sandbox e suspensa têm
-- atividade e volume extremos de propósito: nenhum dos dois pode contaminar.
INSERT INTO public.activities (
  id, organization_id, type, subject, owner_id, is_automated, source, created_at
)
SELECT
  md5('activity:' || o.id::text)::uuid,
  o.id,
  'note',
  'Ação humana',
  tm.id,
  false,
  'manual',
  '2026-08-25 15:00:00+00'::timestamptz
FROM public.organizations o
JOIN public.team_members tm ON tm.organization_id = o.id
WHERE o.slug LIKE 'bench-%'
  AND o.slug <> 'bench-inerte';

SELECT is(
  public.refresh_oraculo_benchmark_weekly('2026-09-07'::date),
  7,
  '(MATERIALIZAÇÃO) grava somente organizações leitoras não sandbox e não bloqueadas'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.oraculo_benchmark_weekly
    WHERE organization_id IN (
      'b0000000-0000-0000-0000-000000000202'::uuid,
      'b0000000-0000-0000-0000-000000000203'::uuid
    )
  ),
  '(ELEGIBILIDADE) sandbox e suspensa não recebem nem contaminam snapshot'
);

CREATE TEMP TABLE benchmark_result AS
SELECT public.oraculo_benchmark(
  'b0000000-0000-0000-0000-000000000001'::uuid
) AS value;

SELECT is(
  value #>> '{external_benchmark,available}',
  'true',
  '(K-ANONIMATO) publica com cinco pares elegíveis além da leitora'
) FROM benchmark_result;

SELECT is(
  (value #>> '{external_benchmark,contributor_count}')::integer,
  5,
  '(AUTOEXCLUSÃO) a própria organização não entra no conjunto que lê'
) FROM benchmark_result;

SELECT is(
  (value #>> '{external_benchmark,metrics,leads_per_active_member,median}')::numeric,
  40.00::numeric,
  '(MEDIANA) leitora extrema, inerte, sandbox e suspensa não deslocam o resultado'
) FROM benchmark_result;

SELECT is(
  (value #>> '{external_benchmark,metrics,average_ticket,median}')::numeric,
  300.00::numeric,
  '(MEDIANA) ticket usa somente vendas da coorte madura dos pares'
) FROM benchmark_result;

SELECT is(
  (value #>> '{external_benchmark,metrics,leads_per_active_member,typical_range,lower}')::numeric,
  30.00::numeric,
  '(FAIXA) limite inferior usa desvio absoluto mediano agregado'
) FROM benchmark_result;

SELECT is(
  (value #>> '{external_benchmark,metrics,leads_per_active_member,typical_range,upper}')::numeric,
  50.00::numeric,
  '(FAIXA) limite superior não publica mínimo ou máximo de uma organização'
) FROM benchmark_result;

SELECT is(
  value #>> '{external_benchmark,language}',
  'entre as operações ativas da base Torque',
  '(LINGUAGEM) benchmark nunca se apresenta como mercado'
) FROM benchmark_result;

SELECT ok(
  value::text !~* 'quartil|organization_id|bench-par|b0000000',
  '(PRIVACIDADE) resposta não carrega quartil, nome ou identificador de par'
) FROM benchmark_result;

SELECT is(
  value #>> '{self_benchmark,available}',
  'true',
  '(AUTO-BENCHMARK) comparação própria sempre acompanha o externo'
) FROM benchmark_result;

SELECT is(
  (value #>> '{self_benchmark,metrics,leads_per_active_member,current}')::numeric,
  100.00::numeric,
  '(AUTO-BENCHMARK) fotografia atual vem da própria organização'
) FROM benchmark_result;

SELECT is(
  (value #>> '{self_benchmark,metrics,leads_per_active_member,previous}')::numeric,
  20.00::numeric,
  '(AUTO-BENCHMARK) oito semanas anteriores são normalizadas para quatro'
) FROM benchmark_result;

SELECT is(
  (value #>> '{self_benchmark,metrics,conversion_rate_pct,current}')::numeric,
  1.00::numeric,
  '(COORTE) duas vendas do mesmo Lead contam uma conversão'
) FROM benchmark_result;

SELECT is(
  (value #>> '{self_benchmark,metrics,average_ticket,current}')::numeric,
  150.00::numeric,
  '(COORTE) venda de Lead antigo ou após maturação não contamina o atual'
) FROM benchmark_result;

-- Tirar uma única ação humana derruba o conjunto de cinco para quatro. O
-- snapshot não publica valor nem contagem abaixo de k; o auto-benchmark fica.
DELETE FROM public.activities
WHERE organization_id = 'b0000000-0000-0000-0000-000000000105'::uuid;
SELECT public.refresh_oraculo_benchmark_weekly('2026-09-07'::date);

SELECT is(
  public.oraculo_benchmark('b0000000-0000-0000-0000-000000000001'::uuid)
    #>> '{external_benchmark,available}',
  'false',
  '(K-ANONIMATO) quatro contribuintes não publicam benchmark'
);

SELECT is(
  public.oraculo_benchmark('b0000000-0000-0000-0000-000000000001'::uuid)
    #>> '{external_benchmark,message}',
  'não tenho base suficiente para comparar',
  '(K-ANONIMATO) falta de base usa mensagem explícita, sem estimativa'
);

SELECT ok(
  NOT (
    public.oraculo_benchmark('b0000000-0000-0000-0000-000000000001'::uuid)
      #> '{external_benchmark}' ? 'contributor_count'
  ),
  '(K-ANONIMATO) tamanho abaixo de k também não é publicado'
);

SELECT is(
  public.oraculo_benchmark('b0000000-0000-0000-0000-000000000001'::uuid)
    #>> '{self_benchmark,available}',
  'true',
  '(AUTO-BENCHMARK) indisponibilidade externa não remove comparação própria'
);

SELECT ok(
  pg_get_functiondef('public.oraculo_benchmark(uuid)'::regprocedure)
    !~* 'from public\.(leads|sale_events|activities|pipeline_stage_events)',
  '(LATÊNCIA) conversa lê snapshot; não agrega fatos operacionais'
);

SELECT has_function(
  'public',
  'refresh_oraculo_benchmark_weekly',
  ARRAY['date'],
  '(CONTRATO) materialização semanal existe'
);

SELECT * FROM finish();
ROLLBACK;
