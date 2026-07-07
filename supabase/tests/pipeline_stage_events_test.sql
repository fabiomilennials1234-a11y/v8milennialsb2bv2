-- supabase/tests/pipeline_stage_events_test.sql
--
-- ISSUE #992 (PRD #986, ADR-0017 §write-model) — pgTAP do caderno
-- pipeline_stage_events.
--
-- Run:
--   supabase test db
-- or:
--   psql "$DATABASE_URL" -f supabase/tests/pipeline_stage_events_test.sql
-- or:
--   pg_prove -d "$DATABASE_URL" supabase/tests/pipeline_stage_events_test.sql
--
-- Asserts:
--   (a) estrutura: tabela, colunas-chave, CHECKs, índices, triggers
--   (b) INSERT de entry gera exatamente 1 evento com from=NULL
--   (c) transição de stage_key gera exatamente 1 evento (from=OLD, to=NEW)
--   (d) UPDATE sem mudança de stage_key (ou com valor igual) NÃO gera evento
--   (e) imutabilidade: UPDATE/DELETE falham como owner (trigger) e como
--       service_role/authenticated (REVOKE, 42501)
--   (f) delete de lead cascateia eventos (única via legítima de remoção)
--   (g) RLS: SELECT isolado por org via get_my_organization_ids();
--       authenticated não INSERE (sem policy, sem grant)

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(35);

-- ---------------------------------------------------------------------------
-- (a) Estrutura
-- ---------------------------------------------------------------------------
SELECT has_table('public', 'pipeline_stage_events', '(a) caderno existe');

SELECT col_not_null('public', 'pipeline_stage_events', 'organization_id',
  '(a) organization_id NOT NULL');
SELECT col_not_null('public', 'pipeline_stage_events', 'lead_id',
  '(a) lead_id NOT NULL');
SELECT col_not_null('public', 'pipeline_stage_events', 'to_stage_key',
  '(a) to_stage_key NOT NULL');
SELECT col_is_null('public', 'pipeline_stage_events', 'from_stage_key',
  '(a) from_stage_key nullable (NULL = entrada no funil)');
SELECT col_is_null('public', 'pipeline_stage_events', 'actor',
  '(a) actor nullable (NULL = automação)');

SELECT ok(
  EXISTS (SELECT 1 FROM pg_trigger
           WHERE tgrelid = 'public.pipeline_entries'::regclass
             AND tgname = 'trg_pipeline_entries_stage_event_insert'),
  '(a) trigger de captura no INSERT existe em pipeline_entries');
SELECT ok(
  EXISTS (SELECT 1 FROM pg_trigger
           WHERE tgrelid = 'public.pipeline_entries'::regclass
             AND tgname = 'trg_pipeline_entries_stage_event_update'),
  '(a) trigger de captura no UPDATE OF stage_key existe em pipeline_entries');
SELECT ok(
  EXISTS (SELECT 1 FROM pg_trigger
           WHERE tgrelid = 'public.pipeline_stage_events'::regclass
             AND tgname = 'trg_pipeline_stage_events_immutable'),
  '(a) trigger de imutabilidade existe no caderno');

-- ---------------------------------------------------------------------------
-- Fixtures: 2 orgs + 2 users + membership + lead + pipeline por org.
-- Seed com triggers OFF (padrão provado do repo) pra não disparar cascatas
-- (auto-assign de pipe default no INSERT de lead etc.); triggers ON de volta
-- antes de exercitar a captura.
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug)
VALUES
  ('99299299-aaaa-0000-0000-000000000992', 'Org A (#992 test)', 'org-a-992-psev'),
  ('99299299-bbbb-0000-0000-000000000992', 'Org B (#992 test)', 'org-b-992-psev')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
) VALUES
  ('99299299-aaaa-1111-0000-000000000992', 'user-a-992@test.local',
   '', now(), '{}'::jsonb, now(), now(),
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', ''),
  ('99299299-bbbb-1111-0000-000000000992', 'user-b-992@test.local',
   '', now(), '{}'::jsonb, now(), now(),
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active)
VALUES
  ('99299299-aaaa-2222-0000-000000000992', '99299299-aaaa-0000-0000-000000000992',
   '99299299-aaaa-1111-0000-000000000992', 'Membro A', 'admin', true),
  ('99299299-bbbb-2222-0000-000000000992', '99299299-bbbb-0000-0000-000000000992',
   '99299299-bbbb-1111-0000-000000000992', 'Membro B', 'admin', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name)
VALUES
  ('99299299-aaaa-3333-0000-000000000992', '99299299-aaaa-0000-0000-000000000992', 'Lead A #992'),
  ('99299299-bbbb-3333-0000-000000000992', '99299299-bbbb-0000-0000-000000000992', 'Lead B #992')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipelines (id, organization_id, name, slug, type)
VALUES
  ('99299299-aaaa-4444-0000-000000000992', '99299299-aaaa-0000-0000-000000000992',
   'Funil Custom A', 'funil-custom-a-992', 'custom'),
  ('99299299-bbbb-4444-0000-000000000992', '99299299-bbbb-0000-0000-000000000992',
   'Funil Custom B', 'funil-custom-b-992', 'custom')
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = origin;  -- triggers ON daqui em diante

-- ---------------------------------------------------------------------------
-- (b) INSERT de entry → exatamente 1 evento, from=NULL
-- ---------------------------------------------------------------------------
INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key)
VALUES ('99299299-aaaa-5555-0000-000000000992', '99299299-aaaa-0000-0000-000000000992',
        '99299299-aaaa-4444-0000-000000000992', '99299299-aaaa-3333-0000-000000000992',
        'etapa_um');

SELECT is(
  (SELECT count(*)::int FROM public.pipeline_stage_events
    WHERE entry_id = '99299299-aaaa-5555-0000-000000000992'),
  1, '(b) INSERT da entry gera exatamente 1 evento');

SELECT is(
  (SELECT from_stage_key FROM public.pipeline_stage_events
    WHERE entry_id = '99299299-aaaa-5555-0000-000000000992'),
  NULL, '(b) evento de entrada tem from_stage_key = NULL');

SELECT is(
  (SELECT to_stage_key FROM public.pipeline_stage_events
    WHERE entry_id = '99299299-aaaa-5555-0000-000000000992'),
  'etapa_um', '(b) evento de entrada tem to_stage_key = stage inicial');

SELECT is(
  (SELECT source FROM public.pipeline_stage_events
    WHERE entry_id = '99299299-aaaa-5555-0000-000000000992'),
  'trigger', '(b) captura ao vivo marca source = trigger');

-- ---------------------------------------------------------------------------
-- (c) Transição de stage_key → exatamente 1 evento novo
-- ---------------------------------------------------------------------------
UPDATE public.pipeline_entries
SET stage_key = 'etapa_dois'
WHERE id = '99299299-aaaa-5555-0000-000000000992';

SELECT is(
  (SELECT count(*)::int FROM public.pipeline_stage_events
    WHERE entry_id = '99299299-aaaa-5555-0000-000000000992'),
  2, '(c) transição gera exatamente 1 evento novo (total 2)');

SELECT is(
  (SELECT from_stage_key FROM public.pipeline_stage_events
    WHERE entry_id = '99299299-aaaa-5555-0000-000000000992'
      AND to_stage_key = 'etapa_dois'),
  'etapa_um', '(c) evento de transição carrega from=OLD.stage_key');

-- ---------------------------------------------------------------------------
-- (d) UPDATE sem transição real NÃO gera evento
-- ---------------------------------------------------------------------------
UPDATE public.pipeline_entries
SET notes = 'touch sem mudar etapa'
WHERE id = '99299299-aaaa-5555-0000-000000000992';

SELECT is(
  (SELECT count(*)::int FROM public.pipeline_stage_events
    WHERE entry_id = '99299299-aaaa-5555-0000-000000000992'),
  2, '(d) UPDATE de outra coluna não gera evento');

-- UPDATE OF stage_key com o MESMO valor (caso real: upsert do sync de
-- custom_pipe_entries põe stage_key no SET sempre) — WHEN barra.
UPDATE public.pipeline_entries
SET stage_key = 'etapa_dois'
WHERE id = '99299299-aaaa-5555-0000-000000000992';

SELECT is(
  (SELECT count(*)::int FROM public.pipeline_stage_events
    WHERE entry_id = '99299299-aaaa-5555-0000-000000000992'),
  2, '(d) SET stage_key = mesmo valor não gera evento');

-- ---------------------------------------------------------------------------
-- (e) Imutabilidade — todas as camadas
-- ---------------------------------------------------------------------------
-- Owner (postgres): grants não se aplicam, mas o trigger dá RAISE.
SELECT throws_ok(
  $$ UPDATE public.pipeline_stage_events
       SET to_stage_key = 'adulterado'
     WHERE entry_id = '99299299-aaaa-5555-0000-000000000992' $$,
  'P0001', NULL,
  '(e) UPDATE falha até como owner — trigger de imutabilidade');

SELECT throws_ok(
  $$ DELETE FROM public.pipeline_stage_events
     WHERE entry_id = '99299299-aaaa-5555-0000-000000000992' $$,
  'P0001', NULL,
  '(e) DELETE direto falha até como owner (pais vivos ⇒ não é cascade)');

-- service_role: REVOKE derruba antes do trigger (42501 permission denied).
SET LOCAL role service_role;

SELECT throws_ok(
  $$ UPDATE public.pipeline_stage_events
       SET to_stage_key = 'adulterado'
     WHERE entry_id = '99299299-aaaa-5555-0000-000000000992' $$,
  '42501', NULL,
  '(e) UPDATE como service_role falha (sem grant)');

SELECT throws_ok(
  $$ DELETE FROM public.pipeline_stage_events
     WHERE entry_id = '99299299-aaaa-5555-0000-000000000992' $$,
  '42501', NULL,
  '(e) DELETE como service_role falha (sem grant)');

SELECT throws_ok(
  $$ INSERT INTO public.pipeline_stage_events
       (organization_id, lead_id, pipeline_id, to_stage_key, source)
     VALUES ('99299299-aaaa-0000-0000-000000000992',
             '99299299-aaaa-3333-0000-000000000992',
             '99299299-aaaa-4444-0000-000000000992', 'forjado', 'trigger') $$,
  '42501', NULL,
  '(e) INSERT direto como service_role falha — append só via trigger definer');

SET LOCAL role postgres;

-- Sanity dos grants no catálogo (não só comportamento):
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.pipeline_stage_events', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.pipeline_stage_events', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.pipeline_stage_events', 'INSERT'),
  '(e) authenticated: só SELECT no catálogo de grants');

SELECT ok(
  NOT has_table_privilege('service_role', 'public.pipeline_stage_events', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.pipeline_stage_events', 'DELETE')
  AND NOT has_table_privilege('service_role', 'public.pipeline_stage_events', 'INSERT'),
  '(e) service_role: só SELECT no catálogo de grants');

-- ---------------------------------------------------------------------------
-- (f) Cascade legítimo: delete do lead leva os eventos junto
-- ---------------------------------------------------------------------------
-- Lead B entra num funil, gera evento, e é hard-deletado.
INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key)
VALUES ('99299299-bbbb-5555-0000-000000000992', '99299299-bbbb-0000-0000-000000000992',
        '99299299-bbbb-4444-0000-000000000992', '99299299-bbbb-3333-0000-000000000992',
        'etapa_b1');

SELECT is(
  (SELECT count(*)::int FROM public.pipeline_stage_events
    WHERE lead_id = '99299299-bbbb-3333-0000-000000000992'),
  1, '(f) fixture org B: 1 evento antes do delete');

DELETE FROM public.leads WHERE id = '99299299-bbbb-3333-0000-000000000992';

SELECT is(
  (SELECT count(*)::int FROM public.pipeline_stage_events
    WHERE lead_id = '99299299-bbbb-3333-0000-000000000992'),
  0, '(f) hard-delete do lead cascateia eventos (ADR-0017: lead deletado não conta)');

-- Repõe fixture da org B pro teste de RLS.
SET LOCAL session_replication_role = replica;
INSERT INTO public.leads (id, organization_id, name)
VALUES ('99299299-bbbb-3333-0000-000000000992',
        '99299299-bbbb-0000-0000-000000000992', 'Lead B #992 v2');
SET LOCAL session_replication_role = origin;

INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key)
VALUES ('99299299-bbbb-6666-0000-000000000992', '99299299-bbbb-0000-0000-000000000992',
        '99299299-bbbb-4444-0000-000000000992', '99299299-bbbb-3333-0000-000000000992',
        'etapa_b1');

-- ---------------------------------------------------------------------------
-- (g) RLS — isolamento multi-tenant
-- ---------------------------------------------------------------------------
SELECT ok(
  (SELECT relrowsecurity FROM pg_class
    WHERE oid = 'public.pipeline_stage_events'::regclass),
  '(g) RLS ENABLED no caderno');

SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'pipeline_stage_events'
             AND policyname = 'pipeline_stage_events_select'
             AND qual ILIKE '%get_my_organization_ids%'),
  '(g) policy de SELECT usa get_my_organization_ids() (nunca team_members inline)');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'pipeline_stage_events'
      AND cmd <> 'SELECT'),
  0, '(g) ZERO policies de escrita — INSERT só via trigger definer');

-- User A enxerga só a própria org.
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"99299299-aaaa-1111-0000-000000000992","role":"authenticated"}', true);

SELECT ok(
  (SELECT count(*) FROM public.pipeline_stage_events
    WHERE organization_id = '99299299-aaaa-0000-0000-000000000992') >= 2,
  '(g) user A vê os eventos da PRÓPRIA org');

SELECT is(
  (SELECT count(*)::int FROM public.pipeline_stage_events
    WHERE organization_id = '99299299-bbbb-0000-0000-000000000992'),
  0, '(g) user A vê ZERO eventos da org B (cross-tenant bloqueado)');

SELECT throws_ok(
  $$ INSERT INTO public.pipeline_stage_events
       (organization_id, lead_id, pipeline_id, to_stage_key, source)
     VALUES ('99299299-aaaa-0000-0000-000000000992',
             '99299299-aaaa-3333-0000-000000000992',
             '99299299-aaaa-4444-0000-000000000992', 'forjado', 'trigger') $$,
  '42501', NULL,
  '(g) authenticated não INSERE direto no caderno');

-- User B enxerga só a org B.
SELECT set_config('request.jwt.claims',
  '{"sub":"99299299-bbbb-1111-0000-000000000992","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.pipeline_stage_events
    WHERE organization_id = '99299299-aaaa-0000-0000-000000000992'),
  0, '(g) user B vê ZERO eventos da org A');

SET LOCAL role postgres;

-- Captura continua funcionando por baixo de contexto de usuário? O move de
-- kanban real roda como authenticated via RLS de pipeline_entries; o trigger
-- é SECURITY DEFINER e escreve mesmo sem grant de INSERT pro role. Simula:
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"99299299-aaaa-1111-0000-000000000992","role":"authenticated"}', true);

UPDATE public.pipeline_entries
SET stage_key = 'etapa_tres'
WHERE id = '99299299-aaaa-5555-0000-000000000992';

SELECT is(
  (SELECT count(*)::int FROM public.pipeline_stage_events
    WHERE entry_id = '99299299-aaaa-5555-0000-000000000992'),
  3, '(g) move como authenticated gera evento via trigger definer');

SELECT is(
  (SELECT actor::text FROM public.pipeline_stage_events
    WHERE entry_id = '99299299-aaaa-5555-0000-000000000992'
      AND to_stage_key = 'etapa_tres'),
  '99299299-aaaa-1111-0000-000000000992',
  '(g) actor = auth.uid() do usuário que moveu');

SET LOCAL role postgres;

SELECT * FROM finish();

ROLLBACK;
