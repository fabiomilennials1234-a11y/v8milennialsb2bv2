-- supabase/tests/commission_projection_test.sql
--
-- ISSUE #994 (PRD #986, ADR-0017 §6) — pgTAP da projeção de comissão.
--
-- Run:
--   supabase test db
-- or:
--   pg_prove -d "$DATABASE_URL" supabase/tests/commission_projection_test.sql
--
-- Asserts:
--   (a) estrutura: colunas novas, UNIQUE(sale_event_id), coerência
--       source ⟺ sale_event_id, triggers, grants por coluna
--   (b) venda → projeção: closer do snapshot, taxa por product_type
--       (mrr/projeto), rate_percent snapshotado, month/year no tz da org,
--       source discriminado (invisível pro filtro manual da UI)
--   (c) defaults de taxa (NULL → 1.0 mrr / implícito) e valor NULL → amount 0
--   (d) venda sem Closer → nenhuma linha; sale_lost → nenhuma linha
--   (e) estorno → linha NEGATIVA no período da ORIGINAL; líquido zero;
--       estorno sem projeção original não fabrica linha
--   (f) venda→estorno→re-venda = 3 linhas rastreáveis; taxa mudada no meio:
--       original preserva snapshot, re-venda usa taxa nova; líquido correto
--   (g) idempotência: mesmo evento nunca projeta 2× (UNIQUE, 23505)
--   (h) guard: projeção aceita só paid; amount/DELETE falham (P0001);
--       source imutável; linha manual segue editável
--   (i) cascade: delete do lead derruba eventos E projeções; manual fica
--   (j) evento source='backfill' não projeta

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(42);

-- ---------------------------------------------------------------------------
-- (a) Estrutura
-- ---------------------------------------------------------------------------
SELECT has_column('public', 'commissions', 'sale_event_id',
  '(a) sale_event_id existe (projeção→evento)');
SELECT has_column('public', 'commissions', 'source',
  '(a) source existe (manual | sale_event_projection)');
SELECT has_column('public', 'commissions', 'rate_percent',
  '(a) rate_percent existe (snapshot da taxa)');

SELECT col_is_unique('public', 'commissions', 'sale_event_id',
  '(a) sale_event_id UNIQUE — 1 evento ⇒ 1 projeção');

SELECT ok(
  EXISTS (SELECT 1 FROM pg_trigger
           WHERE tgrelid = 'public.sale_events'::regclass
             AND tgname = 'trg_sale_events_project_commission'),
  '(a) projeção encadeada no caderno de venda (AFTER INSERT)');
SELECT ok(
  EXISTS (SELECT 1 FROM pg_trigger
           WHERE tgrelid = 'public.commissions'::regclass
             AND tgname = 'trg_commissions_protect_projection'),
  '(a) guard de imutabilidade da projeção existe');

-- Coerência source ⟺ sale_event_id (as duas direções).
SELECT throws_ok(
  $$ INSERT INTO public.commissions
       (team_member_id, amount, type, month, year, source)
     VALUES ('99499499-aaaa-2222-0001-000000000994', 10, 'mrr', 1, 2026,
             'sale_event_projection') $$,
  '23514', NULL,
  '(a) source=projection sem sale_event_id viola CHECK de coerência');

-- Grants por coluna: colunas de projeção fora do alcance dos client roles.
SELECT ok(
  NOT has_column_privilege('authenticated', 'public.commissions', 'source', 'INSERT')
  AND NOT has_column_privilege('authenticated', 'public.commissions', 'sale_event_id', 'INSERT')
  AND NOT has_column_privilege('authenticated', 'public.commissions', 'rate_percent', 'UPDATE')
  AND NOT has_column_privilege('service_role', 'public.commissions', 'sale_event_id', 'INSERT'),
  '(a) client roles não escrevem source/sale_event_id/rate_percent');
SELECT ok(
  has_column_privilege('authenticated', 'public.commissions', 'amount', 'INSERT')
  AND has_column_privilege('authenticated', 'public.commissions', 'paid', 'UPDATE'),
  '(a) fluxo manual vigente preservado (grants nas colunas legadas)');

-- ---------------------------------------------------------------------------
-- Fixtures (padrão #993): seed com triggers OFF.
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug)
VALUES ('99499499-aaaa-0000-0000-000000000994', 'Org A (#994 test)', 'org-a-994-cpj')
ON CONFLICT (id) DO NOTHING;

-- C1: taxas explícitas 10% mrr / 5% projeto. C2: taxas NULL (defaults do
-- cálculo vigente: 1.0 / 0.5).
INSERT INTO public.team_members
  (id, organization_id, name, role, is_active,
   commission_mrr_percent, commission_projeto_percent)
VALUES
  ('99499499-aaaa-2222-0001-000000000994', '99499499-aaaa-0000-0000-000000000994',
   'Closer C1', 'admin', true, 10, 5),
  ('99499499-aaaa-2222-0002-000000000994', '99499499-aaaa-0000-0000-000000000994',
   'Closer C2 sem taxa', 'membro', true, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- L1 mrr/C1 (estorno + re-venda), L2 projeto/C1 (won→lost), L3 sem valor/C1,
-- L4 SEM closer, L5 mrr/C2 (defaults), L6 delete-cascade/C1.
INSERT INTO public.leads (id, organization_id, name, sale_responsible_id)
VALUES
  ('99499499-aaaa-3333-0001-000000000994', '99499499-aaaa-0000-0000-000000000994',
   'L1 mrr', '99499499-aaaa-2222-0001-000000000994'),
  ('99499499-aaaa-3333-0002-000000000994', '99499499-aaaa-0000-0000-000000000994',
   'L2 projeto', '99499499-aaaa-2222-0001-000000000994'),
  ('99499499-aaaa-3333-0003-000000000994', '99499499-aaaa-0000-0000-000000000994',
   'L3 sem valor', '99499499-aaaa-2222-0001-000000000994'),
  ('99499499-aaaa-3333-0004-000000000994', '99499499-aaaa-0000-0000-000000000994',
   'L4 sem closer', NULL),
  ('99499499-aaaa-3333-0005-000000000994', '99499499-aaaa-0000-0000-000000000994',
   'L5 defaults', '99499499-aaaa-2222-0002-000000000994'),
  ('99499499-aaaa-3333-0006-000000000994', '99499499-aaaa-0000-0000-000000000994',
   'L6 cascade', '99499499-aaaa-2222-0001-000000000994')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipelines (id, organization_id, name, slug, type)
VALUES ('99499499-aaaa-4444-0000-000000000994', '99499499-aaaa-0000-0000-000000000994',
        'Propostas A', 'propostas', 'system')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipeline_stages
  (organization_id, pipeline_type, stage_key, name, position, stage_role)
VALUES
  ('99499499-aaaa-0000-0000-000000000994', 'propostas', 'enviada', 'Enviada', 1, 'open'),
  ('99499499-aaaa-0000-0000-000000000994', 'propostas', 'vendido', 'Vendido', 2, 'won'),
  ('99499499-aaaa-0000-0000-000000000994', 'propostas', 'perdido', 'Perdido', 3, 'lost'),
  ('99499499-aaaa-0000-0000-000000000994', 'propostas', 'esfriou', 'Esfriou', 4, 'open')
ON CONFLICT (organization_id, pipeline_type, stage_key) DO UPDATE
  SET stage_role = EXCLUDED.stage_role;

-- Linha MANUAL pré-existente (fluxo vigente): não pode ser afetada por nada.
INSERT INTO public.commissions
  (id, organization_id, team_member_id, amount, type, month, year)
VALUES ('99499499-aaaa-6666-0001-000000000994', '99499499-aaaa-0000-0000-000000000994',
        '99499499-aaaa-2222-0001-000000000994', 777, 'mrr', 1, 2026)
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = origin;  -- triggers ON daqui em diante

-- ---------------------------------------------------------------------------
-- (b) Venda → projeção (mrr e projeto)
-- ---------------------------------------------------------------------------
INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key, metadata)
VALUES ('99499499-aaaa-5555-0001-000000000994', '99499499-aaaa-0000-0000-000000000994',
        '99499499-aaaa-4444-0000-000000000994', '99499499-aaaa-3333-0001-000000000994',
        'enviada', '{"sale_value": 1500.50, "product_type": "mrr"}'::jsonb);

UPDATE public.pipeline_entries SET stage_key = 'vendido'
WHERE id = '99499499-aaaa-5555-0001-000000000994';

SELECT is(
  (SELECT count(*)::int FROM public.commissions c
    JOIN public.sale_events s ON s.id = c.sale_event_id
   WHERE s.lead_id = '99499499-aaaa-3333-0001-000000000994'),
  1, '(b) venda projeta exatamente 1 comissão');

SELECT is(
  (SELECT c.team_member_id::text FROM public.commissions c
    JOIN public.sale_events s ON s.id = c.sale_event_id
   WHERE s.lead_id = '99499499-aaaa-3333-0001-000000000994'),
  '99499499-aaaa-2222-0001-000000000994',
  '(b) comissão vai pro Closer do SNAPSHOT do evento');

SELECT is(
  (SELECT c.amount FROM public.commissions c
    JOIN public.sale_events s ON s.id = c.sale_event_id
   WHERE s.lead_id = '99499499-aaaa-3333-0001-000000000994'),
  150.05::numeric, '(b) amount = 1500.50 × 10% (regra vigente, mrr)');

SELECT is(
  (SELECT c.rate_percent FROM public.commissions c
    JOIN public.sale_events s ON s.id = c.sale_event_id
   WHERE s.lead_id = '99499499-aaaa-3333-0001-000000000994'),
  10::numeric, '(b) rate_percent snapshotado na linha');

SELECT is(
  (SELECT c.source FROM public.commissions c
    JOIN public.sale_events s ON s.id = c.sale_event_id
   WHERE s.lead_id = '99499499-aaaa-3333-0001-000000000994'),
  'sale_event_projection',
  '(b) source discrimina projeção (filtro manual da UI não a vê)');

SELECT is(
  (SELECT (c.month, c.year) = (
      extract(month FROM now() AT TIME ZONE 'America/Sao_Paulo')::int,
      extract(year  FROM now() AT TIME ZONE 'America/Sao_Paulo')::int)
   FROM public.commissions c
   JOIN public.sale_events s ON s.id = c.sale_event_id
   WHERE s.lead_id = '99499499-aaaa-3333-0001-000000000994'),
  true, '(b) month/year cortados no timezone da ORG (ADR-0017 §5)');

SELECT is(
  (SELECT c.pipe_proposta_id::text FROM public.commissions c
    JOIN public.sale_events s ON s.id = c.sale_event_id
   WHERE s.lead_id = '99499499-aaaa-3333-0001-000000000994'),
  '99499499-aaaa-5555-0001-000000000994',
  '(b) pipe_proposta_id aponta a entry que originou a venda');

-- Projeto: taxa projeto (5%).
INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key, metadata)
VALUES ('99499499-aaaa-5555-0002-000000000994', '99499499-aaaa-0000-0000-000000000994',
        '99499499-aaaa-4444-0000-000000000994', '99499499-aaaa-3333-0002-000000000994',
        'enviada', '{"sale_value": 2000, "product_type": "projeto"}'::jsonb);

UPDATE public.pipeline_entries SET stage_key = 'vendido'
WHERE id = '99499499-aaaa-5555-0002-000000000994';

SELECT is(
  (SELECT (c.amount, c.type::text, c.rate_percent)
     FROM public.commissions c
     JOIN public.sale_events s ON s.id = c.sale_event_id
    WHERE s.lead_id = '99499499-aaaa-3333-0002-000000000994') =
  (100::numeric, 'projeto', 5::numeric),
  true, '(b) product_type=projeto usa commission_projeto_percent (2000 × 5% = 100)');

-- ---------------------------------------------------------------------------
-- (c) Defaults e valor desconhecido
-- ---------------------------------------------------------------------------
-- L3: sem metadata → valor NULL → amount 0, type default mrr.
INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key)
VALUES ('99499499-aaaa-5555-0003-000000000994', '99499499-aaaa-0000-0000-000000000994',
        '99499499-aaaa-4444-0000-000000000994', '99499499-aaaa-3333-0003-000000000994',
        'vendido');

SELECT is(
  (SELECT (c.amount, c.type::text)
     FROM public.commissions c
     JOIN public.sale_events s ON s.id = c.sale_event_id
    WHERE s.lead_id = '99499499-aaaa-3333-0003-000000000994') = (0::numeric, 'mrr'),
  true, '(c) valor desconhecido → amount 0 (rastreável), product_type default mrr');

-- L5: taxas do membro NULL → defaults do cálculo vigente (mrr 1.0).
INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key, metadata)
VALUES ('99499499-aaaa-5555-0005-000000000994', '99499499-aaaa-0000-0000-000000000994',
        '99499499-aaaa-4444-0000-000000000994', '99499499-aaaa-3333-0005-000000000994',
        'vendido', '{"sale_value": 1000, "product_type": "mrr"}'::jsonb);

SELECT is(
  (SELECT (c.amount, c.rate_percent)
     FROM public.commissions c
     JOIN public.sale_events s ON s.id = c.sale_event_id
    WHERE s.lead_id = '99499499-aaaa-3333-0005-000000000994') = (10::numeric, 1.0::numeric),
  true, '(c) taxa NULL no membro → default vigente 1.0% (1000 → 10)');

-- ---------------------------------------------------------------------------
-- (d) Venda sem Closer / sale_lost
-- ---------------------------------------------------------------------------
INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key, metadata)
VALUES ('99499499-aaaa-5555-0004-000000000994', '99499499-aaaa-0000-0000-000000000994',
        '99499499-aaaa-4444-0000-000000000994', '99499499-aaaa-3333-0004-000000000994',
        'vendido', '{"sale_value": 5000}'::jsonb);

SELECT is(
  (SELECT count(*)::int FROM public.commissions c
    JOIN public.sale_events s ON s.id = c.sale_event_id
   WHERE s.lead_id = '99499499-aaaa-3333-0004-000000000994'),
  0, '(d) venda sem Closer no snapshot não projeta (vigente também não credita)');

-- L2 won→lost: estorno (projeta negativo) + sale_lost (não projeta).
UPDATE public.pipeline_entries SET stage_key = 'perdido'
WHERE id = '99499499-aaaa-5555-0002-000000000994';

SELECT is(
  (SELECT count(*)::int FROM public.commissions c
    JOIN public.sale_events s ON s.id = c.sale_event_id
   WHERE s.lead_id = '99499499-aaaa-3333-0002-000000000994'
     AND s.event_type = 'sale_lost'),
  0, '(d) sale_lost não projeta comissão');

-- ---------------------------------------------------------------------------
-- (e) Estorno → linha negativa no período da original
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT c.amount FROM public.commissions c
    JOIN public.sale_events s ON s.id = c.sale_event_id
   WHERE s.lead_id = '99499499-aaaa-3333-0002-000000000994'
     AND s.event_type = 'sale_reversed'),
  (-100)::numeric, '(e) estorno projeta espelho NEGATIVO da comissão original');

SELECT is(
  (SELECT (r.month, r.year, r.type::text, r.rate_percent, r.team_member_id) =
          (o.month, o.year, o.type::text, o.rate_percent, o.team_member_id)
     FROM public.commissions r
     JOIN public.sale_events sr ON sr.id = r.sale_event_id
     JOIN public.commissions o ON o.sale_event_id = sr.reversed_event_id
    WHERE sr.lead_id = '99499499-aaaa-3333-0002-000000000994'
      AND sr.event_type = 'sale_reversed'),
  true, '(e) estorno copia período/tipo/taxa/membro DA ORIGINAL (período restaurado)');

SELECT is(
  (SELECT sum(c.amount) FROM public.commissions c
    JOIN public.sale_events s ON s.id = c.sale_event_id
   WHERE s.lead_id = '99499499-aaaa-3333-0002-000000000994'),
  0::numeric, '(e) líquido projetado da venda estornada = ZERO');

-- Estorno sem projeção original (venda sem Closer, L4): nada a anular.
UPDATE public.pipeline_entries SET stage_key = 'esfriou'
WHERE id = '99499499-aaaa-5555-0004-000000000994';

SELECT is(
  (SELECT count(*)::int FROM public.commissions c
    JOIN public.sale_events s ON s.id = c.sale_event_id
   WHERE s.lead_id = '99499499-aaaa-3333-0004-000000000994'),
  0, '(e) estorno de venda sem comissão projetada não fabrica linha');

-- ---------------------------------------------------------------------------
-- (f) venda→estorno→re-venda + taxa snapshotada
-- ---------------------------------------------------------------------------
-- Estorna L1 (sai de won), muda a taxa do C1 no meio, re-vende.
UPDATE public.pipeline_entries SET stage_key = 'esfriou'
WHERE id = '99499499-aaaa-5555-0001-000000000994';

UPDATE public.team_members SET commission_mrr_percent = 20
WHERE id = '99499499-aaaa-2222-0001-000000000994';

UPDATE public.pipeline_entries SET stage_key = 'vendido'
WHERE id = '99499499-aaaa-5555-0001-000000000994';

SELECT is(
  (SELECT count(*)::int FROM public.commissions c
    JOIN public.sale_events s ON s.id = c.sale_event_id
   WHERE s.lead_id = '99499499-aaaa-3333-0001-000000000994'),
  3, '(f) venda→estorno→re-venda = 3 linhas rastreáveis (1:1 com eventos)');

-- (now() é constante na transação → discriminar pelas taxas snapshotadas,
--  que é exatamente a semântica sob teste.)
SELECT is(
  (SELECT c.amount FROM public.commissions c
    JOIN public.sale_events s ON s.id = c.sale_event_id
   WHERE s.lead_id = '99499499-aaaa-3333-0001-000000000994'
     AND s.event_type = 'sale'
     AND c.rate_percent = 10),
  150.05::numeric,
  '(f) taxa SNAPSHOTADA: mudar a taxa depois não reescreve a comissão original');

SELECT is(
  (SELECT c.amount FROM public.commissions c
    JOIN public.sale_events s ON s.id = c.sale_event_id
   WHERE s.lead_id = '99499499-aaaa-3333-0001-000000000994'
     AND s.event_type = 'sale'
     AND c.rate_percent = 20),
  300.10::numeric, '(f) re-venda usa a taxa NOVA (1500.50 × 20% = 300.10)');

SELECT is(
  (SELECT sum(c.amount) FROM public.commissions c
    JOIN public.sale_events s ON s.id = c.sale_event_id
   WHERE s.lead_id = '99499499-aaaa-3333-0001-000000000994'),
  300.10::numeric, '(f) líquido do ciclo = só a re-venda (150.05 − 150.05 + 300.10)');

-- ---------------------------------------------------------------------------
-- (g) Idempotência
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ INSERT INTO public.commissions
       (organization_id, team_member_id, amount, type, month, year,
        sale_event_id, source, rate_percent)
     SELECT c.organization_id, c.team_member_id, c.amount, c.type, c.month,
            c.year, c.sale_event_id, c.source, c.rate_percent
       FROM public.commissions c WHERE c.sale_event_id IS NOT NULL LIMIT 1 $$,
  '23505', NULL,
  '(g) mesmo evento NUNCA projeta 2× — UNIQUE(sale_event_id)');

SELECT is(
  (SELECT count(*)::int FROM (
     SELECT c.sale_event_id FROM public.commissions c
      WHERE c.sale_event_id IS NOT NULL
      GROUP BY c.sale_event_id HAVING count(*) > 1) d),
  0, '(g) zero eventos com projeção duplicada');

-- ---------------------------------------------------------------------------
-- (h) Guard: projeção imutável exceto paid; manual segue livre
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ UPDATE public.commissions SET amount = 999999
     WHERE source = 'sale_event_projection' $$,
  'P0001', NULL,
  '(h) UPDATE de amount em projeção falha até como owner');

SELECT throws_ok(
  $$ DELETE FROM public.commissions
     WHERE source = 'sale_event_projection' $$,
  'P0001', NULL,
  '(h) DELETE de projeção falha (evento pai vivo ⇒ não é cascade)');

SELECT lives_ok(
  $$ UPDATE public.commissions SET paid = true
     WHERE source = 'sale_event_projection'
       AND amount > 0 $$,
  '(h) paid é editável em projeção (estado operacional, não métrica)');

SELECT throws_ok(
  $$ UPDATE public.commissions SET source = 'manual'
     WHERE source = 'sale_event_projection' $$,
  'P0001', NULL,
  '(h) source é imutável — projeção não vira manual');

SELECT lives_ok(
  $$ UPDATE public.commissions SET amount = 778
     WHERE id = '99499499-aaaa-6666-0001-000000000994' $$,
  '(h) linha MANUAL segue editável (fluxo vigente intacto)');

SELECT throws_ok(
  $$ UPDATE public.commissions SET source = 'sale_event_projection'
     WHERE id = '99499499-aaaa-6666-0001-000000000994' $$,
  'P0001', NULL,
  '(h) linha manual não vira projeção (anti-spoof)');

-- ---------------------------------------------------------------------------
-- (i) Cascade legítimo
-- ---------------------------------------------------------------------------
INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key, metadata)
VALUES ('99499499-aaaa-5555-0006-000000000994', '99499499-aaaa-0000-0000-000000000994',
        '99499499-aaaa-4444-0000-000000000994', '99499499-aaaa-3333-0006-000000000994',
        'vendido', '{"sale_value": 100, "product_type": "mrr"}'::jsonb);

SELECT is(
  (SELECT count(*)::int FROM public.commissions c
    WHERE c.pipe_proposta_id = '99499499-aaaa-5555-0006-000000000994'),
  1, '(i) fixture L6: projeção existe antes do delete');

DELETE FROM public.leads WHERE id = '99499499-aaaa-3333-0006-000000000994';

SELECT is(
  (SELECT count(*)::int FROM public.commissions c
    WHERE c.pipe_proposta_id IS NULL
      AND c.sale_event_id IS NOT NULL),
  0, '(i) delete do lead cascateia evento e projeção juntos');

SELECT is(
  (SELECT amount FROM public.commissions
    WHERE id = '99499499-aaaa-6666-0001-000000000994'),
  778::numeric, '(i) linha manual sobrevive intacta');

-- Deletar MEMBRO cascateia comissões dele (fluxo vigente) — guard não bloqueia.
SELECT lives_ok(
  $$ DELETE FROM public.team_members
     WHERE id = '99499499-aaaa-2222-0002-000000000994' $$,
  '(i) delete de team_member cascateia projeções dele sem quebrar (fluxo vigente)');

-- ---------------------------------------------------------------------------
-- (j) Backfill não projeta
-- ---------------------------------------------------------------------------
INSERT INTO public.sale_events
  (id, organization_id, lead_id, pipeline_id, stage_key, event_type,
   sold_at, sale_value, revenue_stream, sale_responsible_id, source)
VALUES
  ('99499499-aaaa-8888-0001-000000000994', '99499499-aaaa-0000-0000-000000000994',
   '99499499-aaaa-3333-0001-000000000994', '99499499-aaaa-4444-0000-000000000994',
   'vendido', 'sale', '2026-01-15T12:00:00Z', 4000, 'novo_negocio',
   '99499499-aaaa-2222-0001-000000000994', 'backfill');

SELECT is(
  (SELECT count(*)::int FROM public.commissions
    WHERE sale_event_id = '99499499-aaaa-8888-0001-000000000994'),
  0, '(j) evento source=backfill NÃO projeta (migration governada decide)');

SELECT * FROM finish();

ROLLBACK;
