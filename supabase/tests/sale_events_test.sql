-- supabase/tests/sale_events_test.sql
--
-- ISSUE #993 (PRD #986, ADR-0017 §2-4) — pgTAP do caderno sale_events.
--
-- Run:
--   supabase test db
-- or:
--   pg_prove -d "$DATABASE_URL" supabase/tests/sale_events_test.sql
--
-- Asserts:
--   (a) estrutura: tabela, CHECKs de coerência, triggers, resolvedor de role
--   (b) won gera sale com Revenue Stream correto nos 2 cenários:
--       lead novo → novo_negocio; cliente Carteira ativo vendendo pelo
--       funil NORMAL → carteira (user story 7)
--   (c) snapshot: sale_value/currency da entry, atribuição do lead
--       (sale_responsible_id canônico + fallback legado closer_id)
--   (d) sold_at = now() sempre — tentativa de informar data é ignorada
--       (owner) ou falha (roles, 42501)
--   (e) saída de won gera sale_reversed apontando a original; leitura
--       líquida (sale + estorno) do período original = zero; won→won não
--       duplica venda; saída de won sem venda registrada não estorna
--   (f) lost gera sale_lost; lost→lost não duplica
--   (g) imutabilidade: UPDATE/DELETE falham até como owner (P0001) e como
--       service_role/authenticated (42501); INSERT direto idem
--   (h) RLS isola por org; funil custom (sem governança de role) não emite
--   (i) delete de lead cascateia (venda + estorno somem — não conta em métrica)

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(48);

-- ---------------------------------------------------------------------------
-- (a) Estrutura
-- ---------------------------------------------------------------------------
SELECT has_table('public', 'sale_events', '(a) caderno existe');
SELECT col_not_null('public', 'sale_events', 'revenue_stream',
  '(a) revenue_stream NOT NULL');
SELECT col_not_null('public', 'sale_events', 'sold_at',
  '(a) sold_at NOT NULL');
SELECT col_is_null('public', 'sale_events', 'sale_value',
  '(a) sale_value nullable (desconhecido ≠ 0)');

SELECT ok(
  EXISTS (SELECT 1 FROM pg_trigger
           WHERE tgrelid = 'public.pipeline_stage_events'::regclass
             AND tgname = 'trg_pipeline_stage_events_sale_capture'),
  '(a) captura encadeada no caderno de etapa (AFTER INSERT)');
SELECT ok(
  EXISTS (SELECT 1 FROM pg_trigger
           WHERE tgrelid = 'public.sale_events'::regclass
             AND tgname = 'trg_sale_events_immutable'),
  '(a) trigger de imutabilidade existe');
SELECT ok(
  EXISTS (SELECT 1 FROM pg_trigger
           WHERE tgrelid = 'public.sale_events'::regclass
             AND tgname = 'trg_sale_events_force_sold_at'),
  '(a) normalizador de sold_at existe');
SELECT has_function('public', 'metric_stage_role', ARRAY['uuid', 'uuid', 'text'],
  '(a) resolvedor de role existe');

-- CHECK de coerência do estorno (as duas direções).
SELECT throws_ok(
  $$ INSERT INTO public.sale_events
       (organization_id, lead_id, pipeline_id, stage_key, event_type, revenue_stream)
     VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
             'x', 'sale_reversed', 'novo_negocio') $$,
  '23514', NULL,
  '(a) sale_reversed sem reversed_event_id viola CHECK');

-- ---------------------------------------------------------------------------
-- Fixtures: 2 orgs, users, membership, leads, pipelines system 'propostas'
-- + stages governadas + funil custom. Seed com triggers OFF (padrão do repo).
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug)
VALUES
  ('99399399-aaaa-0000-0000-000000000993', 'Org A (#993 test)', 'org-a-993-sev'),
  ('99399399-bbbb-0000-0000-000000000993', 'Org B (#993 test)', 'org-b-993-sev')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
) VALUES
  ('99399399-aaaa-1111-0000-000000000993', 'user-a-993@test.local',
   '', now(), '{}'::jsonb, now(), now(),
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', ''),
  ('99399399-bbbb-1111-0000-000000000993', 'user-b-993@test.local',
   '', now(), '{}'::jsonb, now(), now(),
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active)
VALUES
  ('99399399-aaaa-2222-0000-000000000993', '99399399-aaaa-0000-0000-000000000993',
   '99399399-aaaa-1111-0000-000000000993', 'Closer A', 'admin', true),
  ('99399399-aaaa-2222-0001-000000000993', '99399399-aaaa-0000-0000-000000000993',
   NULL, 'SDR A', 'membro', true),
  ('99399399-bbbb-2222-0000-000000000993', '99399399-bbbb-0000-0000-000000000993',
   '99399399-bbbb-1111-0000-000000000993', 'Closer B', 'admin', true)
ON CONFLICT (id) DO NOTHING;

-- Leads: L1 novo negócio (atribuição canônica completa), L2 cliente
-- Carteira, L3 fallback legado (só closer_id), L4 org B (RLS + cascade).
INSERT INTO public.leads (id, organization_id, name,
                          sale_responsible_id, pre_sale_responsible_id, closer_id)
VALUES
  ('99399399-aaaa-3333-0001-000000000993', '99399399-aaaa-0000-0000-000000000993',
   'Lead L1 novo negocio', '99399399-aaaa-2222-0000-000000000993',
   '99399399-aaaa-2222-0001-000000000993', NULL),
  ('99399399-aaaa-3333-0002-000000000993', '99399399-aaaa-0000-0000-000000000993',
   'Lead L2 carteira', '99399399-aaaa-2222-0000-000000000993', NULL, NULL),
  ('99399399-aaaa-3333-0003-000000000993', '99399399-aaaa-0000-0000-000000000993',
   'Lead L3 fallback legado', NULL, NULL, '99399399-aaaa-2222-0000-000000000993'),
  ('99399399-bbbb-3333-0001-000000000993', '99399399-bbbb-0000-0000-000000000993',
   'Lead L4 org B', NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- L2 é Carteira Client ATIVO — vende pelo funil NORMAL (user story 7).
INSERT INTO public.upsell_clients (id, organization_id, lead_id, name, is_active)
VALUES ('99399399-aaaa-7777-0000-000000000993', '99399399-aaaa-0000-0000-000000000993',
        '99399399-aaaa-3333-0002-000000000993', 'Cliente Carteira L2', true)
ON CONFLICT (id) DO NOTHING;

-- Funis: propostas system (A e B) + custom (A, sem governança de role).
INSERT INTO public.pipelines (id, organization_id, name, slug, type)
VALUES
  ('99399399-aaaa-4444-0000-000000000993', '99399399-aaaa-0000-0000-000000000993',
   'Propostas A', 'propostas', 'system'),
  ('99399399-bbbb-4444-0000-000000000993', '99399399-bbbb-0000-0000-000000000993',
   'Propostas B', 'propostas', 'system'),
  ('99399399-aaaa-4444-0001-000000000993', '99399399-aaaa-0000-0000-000000000993',
   'Funil Custom A', 'funil-custom-a-993', 'custom')
ON CONFLICT (id) DO NOTHING;

-- Stages governadas (roles explícitos; inclui 2º stage won pro caso won→won).
INSERT INTO public.pipeline_stages
  (organization_id, pipeline_type, stage_key, name, position, stage_role)
VALUES
  ('99399399-aaaa-0000-0000-000000000993', 'propostas', 'enviada',    'Proposta Enviada', 1, 'open'),
  ('99399399-aaaa-0000-0000-000000000993', 'propostas', 'vendido',    'Vendido',          2, 'won'),
  ('99399399-aaaa-0000-0000-000000000993', 'propostas', 'vendido_vip','Vendido VIP',      3, 'won'),
  ('99399399-aaaa-0000-0000-000000000993', 'propostas', 'perdido',    'Perdido',          4, 'lost'),
  ('99399399-aaaa-0000-0000-000000000993', 'propostas', 'esfriou',    'Esfriou',          5, 'open'),
  ('99399399-bbbb-0000-0000-000000000993', 'propostas', 'enviada',    'Proposta Enviada', 1, 'open'),
  ('99399399-bbbb-0000-0000-000000000993', 'propostas', 'vendido',    'Vendido',          2, 'won')
ON CONFLICT (organization_id, pipeline_type, stage_key) DO UPDATE
  SET stage_role = EXCLUDED.stage_role;

SET LOCAL session_replication_role = origin;  -- triggers ON daqui em diante

-- ---------------------------------------------------------------------------
-- (b) won → sale, Revenue Stream pelos 2 cenários
-- ---------------------------------------------------------------------------
-- L1 (lead novo) entra em 'enviada' e transiciona pra 'vendido' com valor.
INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key, metadata)
VALUES ('99399399-aaaa-5555-0001-000000000993', '99399399-aaaa-0000-0000-000000000993',
        '99399399-aaaa-4444-0000-000000000993', '99399399-aaaa-3333-0001-000000000993',
        'enviada', '{"sale_value": 1500.50}'::jsonb);

SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE lead_id = '99399399-aaaa-3333-0001-000000000993'),
  0, '(b) entrada em stage open não gera evento de venda');

UPDATE public.pipeline_entries
SET stage_key = 'vendido'
WHERE id = '99399399-aaaa-5555-0001-000000000993';

SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE lead_id = '99399399-aaaa-3333-0001-000000000993'
      AND event_type = 'sale'),
  1, '(b) transição pra won gera exatamente 1 sale');

SELECT is(
  (SELECT revenue_stream FROM public.sale_events
    WHERE lead_id = '99399399-aaaa-3333-0001-000000000993'
      AND event_type = 'sale'),
  'novo_negocio', '(b) lead sem Carteira Client → novo_negocio');

-- L2 (Carteira Client ATIVO) vende pelo MESMO funil normal de propostas.
INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key, metadata)
VALUES ('99399399-aaaa-5555-0002-000000000993', '99399399-aaaa-0000-0000-000000000993',
        '99399399-aaaa-4444-0000-000000000993', '99399399-aaaa-3333-0002-000000000993',
        'enviada', '{"sale_value": 900}'::jsonb);

UPDATE public.pipeline_entries
SET stage_key = 'vendido'
WHERE id = '99399399-aaaa-5555-0002-000000000993';

SELECT is(
  (SELECT revenue_stream FROM public.sale_events
    WHERE lead_id = '99399399-aaaa-3333-0002-000000000993'
      AND event_type = 'sale'),
  'carteira', '(b) Carteira Client ativo vendendo pelo funil normal → carteira (user story 7)');

-- ---------------------------------------------------------------------------
-- (c) Snapshots: valor, moeda, atribuição
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT sale_value FROM public.sale_events
    WHERE lead_id = '99399399-aaaa-3333-0001-000000000993' AND event_type = 'sale'),
  1500.50::numeric, '(c) sale_value snapshotado da metadata da entry');

SELECT is(
  (SELECT currency FROM public.sale_events
    WHERE lead_id = '99399399-aaaa-3333-0001-000000000993' AND event_type = 'sale'),
  'BRL', '(c) currency default BRL');

SELECT is(
  (SELECT sale_responsible_id::text FROM public.sale_events
    WHERE lead_id = '99399399-aaaa-3333-0001-000000000993' AND event_type = 'sale'),
  '99399399-aaaa-2222-0000-000000000993',
  '(c) sale_responsible_id = Closer canônico do lead');

SELECT is(
  (SELECT pre_sale_responsible_id::text FROM public.sale_events
    WHERE lead_id = '99399399-aaaa-3333-0001-000000000993' AND event_type = 'sale'),
  '99399399-aaaa-2222-0001-000000000993',
  '(c) pre_sale_responsible_id snapshotado do lead');

-- L3: sale_responsible_id NULL, closer_id legado preenchido → fallback.
INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key)
VALUES ('99399399-aaaa-5555-0003-000000000993', '99399399-aaaa-0000-0000-000000000993',
        '99399399-aaaa-4444-0000-000000000993', '99399399-aaaa-3333-0003-000000000993',
        'vendido');  -- INSERT direto em won (venda manual) também captura

SELECT is(
  (SELECT sale_responsible_id::text FROM public.sale_events
    WHERE lead_id = '99399399-aaaa-3333-0003-000000000993' AND event_type = 'sale'),
  '99399399-aaaa-2222-0000-000000000993',
  '(c) fallback legado closer_id na transição (ADR-0017 §5)');

SELECT is(
  (SELECT sale_value FROM public.sale_events
    WHERE lead_id = '99399399-aaaa-3333-0003-000000000993' AND event_type = 'sale'),
  NULL, '(c) valor ausente → NULL (nunca 0 fabricado)');

-- ---------------------------------------------------------------------------
-- (d) sold_at = now() sempre
-- ---------------------------------------------------------------------------
SELECT ok(
  (SELECT bool_and(sold_at BETWEEN now() - interval '1 minute' AND now())
   FROM public.sale_events
   WHERE organization_id = '99399399-aaaa-0000-0000-000000000993'),
  '(d) sold_at = momento do registro em todos os eventos');

-- Owner tenta backdate com source=trigger → normalizador ignora a data.
INSERT INTO public.sale_events
  (organization_id, lead_id, pipeline_id, stage_key, event_type,
   sold_at, revenue_stream, source)
VALUES ('99399399-aaaa-0000-0000-000000000993', '99399399-aaaa-3333-0001-000000000993',
        '99399399-aaaa-4444-0000-000000000993', 'vendido', 'sale',
        '2020-01-01T00:00:00Z', 'novo_negocio', 'trigger');

SELECT ok(
  (SELECT sold_at > now() - interval '1 minute' FROM public.sale_events
    WHERE lead_id = '99399399-aaaa-3333-0001-000000000993'
    ORDER BY created_at DESC LIMIT 1),
  '(d) sold_at informado é IGNORADO — normalizado pra now() (ADR-0017 §4)');

-- ---------------------------------------------------------------------------
-- (e) Estorno
-- ---------------------------------------------------------------------------
-- won → won (vendido → vendido_vip): mesma venda, nada novo.
UPDATE public.pipeline_entries
SET stage_key = 'vendido_vip'
WHERE id = '99399399-aaaa-5555-0002-000000000993';

SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE lead_id = '99399399-aaaa-3333-0002-000000000993'),
  1, '(e) won→won não duplica venda nem estorna');

-- Saída de won (vendido_vip → esfriou): estorno apontando a original.
UPDATE public.pipeline_entries
SET stage_key = 'esfriou'
WHERE id = '99399399-aaaa-5555-0002-000000000993';

SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE lead_id = '99399399-aaaa-3333-0002-000000000993'
      AND event_type = 'sale_reversed'),
  1, '(e) saída de won gera exatamente 1 sale_reversed');

SELECT is(
  (SELECT r.reversed_event_id FROM public.sale_events r
    WHERE r.lead_id = '99399399-aaaa-3333-0002-000000000993'
      AND r.event_type = 'sale_reversed'),
  (SELECT s.id FROM public.sale_events s
    WHERE s.lead_id = '99399399-aaaa-3333-0002-000000000993'
      AND s.event_type = 'sale'),
  '(e) estorno referencia a venda original');

SELECT is(
  (SELECT r.sale_value FROM public.sale_events r
    WHERE r.lead_id = '99399399-aaaa-3333-0002-000000000993'
      AND r.event_type = 'sale_reversed'),
  900::numeric, '(e) estorno copia o valor anulado da original');

SELECT is(
  (SELECT r.revenue_stream FROM public.sale_events r
    WHERE r.lead_id = '99399399-aaaa-3333-0002-000000000993'
      AND r.event_type = 'sale_reversed'),
  'carteira', '(e) estorno copia o stream da original');

-- Leitura líquida do período original = zero (venda + estorno se anulam;
-- estorno ancorado ao período da ORIGINAL via reversed_event_id).
SELECT is(
  (SELECT (
     COALESCE((SELECT sum(s.sale_value) FROM public.sale_events s
                WHERE s.lead_id = '99399399-aaaa-3333-0002-000000000993'
                  AND s.event_type = 'sale'
                  AND s.sold_at >= date_trunc('day', now())), 0)
     -
     COALESCE((SELECT sum(o.sale_value)
                FROM public.sale_events r
                JOIN public.sale_events o ON o.id = r.reversed_event_id
                WHERE r.lead_id = '99399399-aaaa-3333-0002-000000000993'
                  AND r.event_type = 'sale_reversed'
                  AND o.sold_at >= date_trunc('day', now())), 0)
   )::numeric),
  0::numeric, '(e) leitura líquida (sale + estorno) do período original = ZERO');

-- Segunda saída de won sem venda aberta: L2 volta pra vendido... e sai de
-- novo → novo par sale/estorno; mas saída de won SEM venda não-estornada
-- (simulada movendo L1-org-B pré-caderno) não estorna:
SET LOCAL session_replication_role = replica;
INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key)
VALUES ('99399399-bbbb-5555-0001-000000000993', '99399399-bbbb-0000-0000-000000000993',
        '99399399-bbbb-4444-0000-000000000993', '99399399-bbbb-3333-0001-000000000993',
        'vendido');  -- entrou em won com triggers OFF = won pré-caderno
SET LOCAL session_replication_role = origin;

UPDATE public.pipeline_entries
SET stage_key = 'enviada'
WHERE id = '99399399-bbbb-5555-0001-000000000993';

SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE lead_id = '99399399-bbbb-3333-0001-000000000993'),
  0, '(e) saída de won sem venda registrada (pré-caderno) não fabrica estorno');

-- ---------------------------------------------------------------------------
-- (f) lost → sale_lost
-- ---------------------------------------------------------------------------
UPDATE public.pipeline_entries
SET stage_key = 'perdido'
WHERE id = '99399399-aaaa-5555-0001-000000000993';
-- L1 estava em 'vendido' → won→lost = estorno + sale_lost.

SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE lead_id = '99399399-aaaa-3333-0001-000000000993'
      AND event_type = 'sale_lost'),
  1, '(f) entrada em lost gera sale_lost');

SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE lead_id = '99399399-aaaa-3333-0001-000000000993'
      AND event_type = 'sale_reversed'),
  1, '(f) won→lost também estorna a venda (dois fatos, dois eventos)');

-- lost → lost-equivalente não existe no fixture; touch sem transição:
UPDATE public.pipeline_entries
SET notes = 'touch'
WHERE id = '99399399-aaaa-5555-0001-000000000993';

SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE lead_id = '99399399-aaaa-3333-0001-000000000993'),
  4, '(f) UPDATE sem transição não gera evento (sale + backdate-test + estorno + lost)');

-- ---------------------------------------------------------------------------
-- (g) Imutabilidade — todas as camadas
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ UPDATE public.sale_events SET sale_value = 999999
     WHERE lead_id = '99399399-aaaa-3333-0001-000000000993' $$,
  'P0001', NULL,
  '(g) UPDATE falha até como owner — trigger de imutabilidade');

SELECT throws_ok(
  $$ DELETE FROM public.sale_events
     WHERE lead_id = '99399399-aaaa-3333-0001-000000000993' $$,
  'P0001', NULL,
  '(g) DELETE direto falha até como owner (pais vivos ⇒ não é cascade)');

SET LOCAL role service_role;

SELECT throws_ok(
  $$ UPDATE public.sale_events SET sale_value = 999999 $$,
  '42501', NULL,
  '(g) UPDATE como service_role falha (sem grant)');

SELECT throws_ok(
  $$ DELETE FROM public.sale_events $$,
  '42501', NULL,
  '(g) DELETE como service_role falha (sem grant)');

SELECT throws_ok(
  $$ INSERT INTO public.sale_events
       (organization_id, lead_id, pipeline_id, stage_key, event_type, revenue_stream)
     VALUES ('99399399-aaaa-0000-0000-000000000993',
             '99399399-aaaa-3333-0001-000000000993',
             '99399399-aaaa-4444-0000-000000000993', 'forjado', 'sale', 'novo_negocio') $$,
  '42501', NULL,
  '(g) INSERT direto como service_role falha — append só via trigger definer');

SET LOCAL role postgres;

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.sale_events', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.sale_events', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.sale_events', 'INSERT'),
  '(g) authenticated: só SELECT no catálogo de grants');

SELECT ok(
  NOT has_table_privilege('service_role', 'public.sale_events', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.sale_events', 'DELETE')
  AND NOT has_table_privilege('service_role', 'public.sale_events', 'INSERT'),
  '(g) service_role: só SELECT no catálogo de grants');

-- ---------------------------------------------------------------------------
-- (h) RLS + funil custom
-- ---------------------------------------------------------------------------
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sale_events'::regclass),
  '(h) RLS ENABLED no caderno');

SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'sale_events'
             AND policyname = 'sale_events_select'
             AND qual ILIKE '%get_my_organization_ids%'),
  '(h) policy de SELECT usa get_my_organization_ids()');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sale_events'
      AND cmd <> 'SELECT'),
  0, '(h) ZERO policies de escrita');

-- Org B: venda própria pra testar isolamento.
UPDATE public.pipeline_entries
SET stage_key = 'vendido'
WHERE id = '99399399-bbbb-5555-0001-000000000993';

SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE lead_id = '99399399-bbbb-3333-0001-000000000993' AND event_type = 'sale'),
  1, '(h) fixture org B: venda registrada');

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"99399399-aaaa-1111-0000-000000000993","role":"authenticated"}', true);

SELECT ok(
  (SELECT count(*) FROM public.sale_events
    WHERE organization_id = '99399399-aaaa-0000-0000-000000000993') >= 4,
  '(h) user A vê as vendas da PRÓPRIA org');

SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE organization_id = '99399399-bbbb-0000-0000-000000000993'),
  0, '(h) user A vê ZERO vendas da org B (cross-tenant bloqueado)');

SELECT throws_ok(
  $$ INSERT INTO public.sale_events
       (organization_id, lead_id, pipeline_id, stage_key, event_type, revenue_stream)
     VALUES ('99399399-aaaa-0000-0000-000000000993',
             '99399399-aaaa-3333-0001-000000000993',
             '99399399-aaaa-4444-0000-000000000993', 'forjado', 'sale', 'novo_negocio') $$,
  '42501', NULL,
  '(h) authenticated não INSERE direto no caderno');

SET LOCAL role postgres;

-- Funil custom (definições em custom_pipeline_stages, sem stage_role ainda):
-- stage de nome "vendido" NÃO emite venda — governança de role é pré-condição.
INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key)
VALUES ('99399399-aaaa-5555-0004-000000000993', '99399399-aaaa-0000-0000-000000000993',
        '99399399-aaaa-4444-0001-000000000993', '99399399-aaaa-3333-0001-000000000993',
        'vendido');

SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE pipeline_id = '99399399-aaaa-4444-0001-000000000993'),
  0, '(h) funil custom sem governança de role não emite venda (limitação declarada #993)');

-- ---------------------------------------------------------------------------
-- (i) Cascade legítimo: delete do lead leva venda + estorno juntos
-- ---------------------------------------------------------------------------
SELECT ok(
  (SELECT count(*) FROM public.sale_events
    WHERE lead_id = '99399399-aaaa-3333-0002-000000000993') >= 2,
  '(i) fixture L2: venda + estorno existem antes do delete');

-- L2 é Carteira Client (FK RESTRICT em upsell_clients) — remove o vínculo
-- primeiro, como um teardown real de org faria.
DELETE FROM public.upsell_clients
WHERE lead_id = '99399399-aaaa-3333-0002-000000000993';
DELETE FROM public.leads
WHERE id = '99399399-aaaa-3333-0002-000000000993';

SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE lead_id = '99399399-aaaa-3333-0002-000000000993'),
  0, '(i) hard-delete do lead cascateia venda e estorno (não conta em métrica)');

SELECT * FROM finish();

ROLLBACK;
