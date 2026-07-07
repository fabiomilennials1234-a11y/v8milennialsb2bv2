-- supabase/tests/stage_role_test.sql
--
-- ISSUE #990 (PRD #986, ADR-0017 §1) — pgTAP coverage do stage_role.
--
-- Run:
--   supabase test db            # runs every *_test.sql under supabase/tests/
-- or directly against a local stack:
--   psql "$DATABASE_URL" -f supabase/tests/stage_role_test.sql
-- or with pg_prove:
--   pg_prove -d "$DATABASE_URL" supabase/tests/stage_role_test.sql
--
-- Asserts:
--   (a) enum + coluna: tipo existe com os 5 labels; coluna NOT NULL DEFAULT 'open'
--   (b) role é EXCLUSIVO por construção: UPDATE para valor fora do enum falha (22P02)
--   (c) backfill/seed determinístico: stages de sistema recebem o role do mapa
--       (via create_default_pipeline_stages + trigger BEFORE INSERT)
--   (d) stages custom ficam 'open'; role explícito no INSERT é respeitado
--   (e) renomear stage (name) NÃO altera o role
--   (f) RLS de pipeline_stages intacta (relrowsecurity + policies de tenant)

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(28);

-- ---------------------------------------------------------------------------
-- (a) Estrutura: enum + coluna
-- ---------------------------------------------------------------------------
SELECT has_type('public', 'stage_role', 'enum stage_role exists');

SELECT enum_has_labels('public', 'stage_role',
  ARRAY['open', 'meeting_booked', 'meeting_held', 'won', 'lost'],
  '(a) enum has exactly open|meeting_booked|meeting_held|won|lost');

SELECT has_column('public', 'pipeline_stages', 'stage_role',
  '(a) pipeline_stages.stage_role exists');

SELECT col_not_null('public', 'pipeline_stages', 'stage_role',
  '(a) stage_role is NOT NULL');

SELECT is(
  (SELECT udt_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pipeline_stages'
      AND column_name = 'stage_role'),
  'stage_role',
  '(a) stage_role column is of enum type stage_role');

SELECT ok(
  (SELECT column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pipeline_stages'
      AND column_name = 'stage_role') LIKE '%open%',
  '(a) stage_role DEFAULT is ''open''');

SELECT has_function('public', 'system_stage_role', ARRAY['text', 'text'],
  '(a) deterministic map function system_stage_role(text,text) exists');

-- ---------------------------------------------------------------------------
-- Fixture: uma org nova, seed default de stages COM triggers ativos
-- (exercita o BEFORE INSERT + mapa exatamente como uma org nova real).
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;  -- table owner / privileged seed context
SET LOCAL session_replication_role = replica;  -- org insert sem cascatas

INSERT INTO public.organizations (id, name, slug)
VALUES ('99099099-0000-0000-0000-000000000990', 'Org #990 stage_role test',
        'org-990-stage-role-test')
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = origin;  -- triggers ON daqui em diante

SELECT create_default_pipeline_stages('99099099-0000-0000-0000-000000000990');

-- Chaves do funil mergeado (ADR-0004) não vêm no default — insere como o
-- rollout real (20261124000000) faria, pra provar o mapa nelas também.
INSERT INTO public.pipeline_stages
  (organization_id, pipeline_type, stage_key, name, color, position)
VALUES
  ('99099099-0000-0000-0000-000000000990', 'whatsapp', 'compareceu',
   'Compareceu', '#22c55e', 90),
  ('99099099-0000-0000-0000-000000000990', 'whatsapp', 'nao_compareceu',
   'Não compareceu', '#ef4444', 91);

-- ---------------------------------------------------------------------------
-- (c) Mapa determinístico aplicado a 100% das stages de sistema
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT stage_role::text FROM public.pipeline_stages
    WHERE organization_id = '99099099-0000-0000-0000-000000000990'
      AND pipeline_type = 'propostas' AND stage_key = 'vendido'),
  'won', '(c) propostas/vendido → won');

SELECT is(
  (SELECT stage_role::text FROM public.pipeline_stages
    WHERE organization_id = '99099099-0000-0000-0000-000000000990'
      AND pipeline_type = 'propostas' AND stage_key = 'perdido'),
  'lost', '(c) propostas/perdido → lost');

SELECT is(
  (SELECT stage_role::text FROM public.pipeline_stages
    WHERE organization_id = '99099099-0000-0000-0000-000000000990'
      AND pipeline_type = 'confirmacao' AND stage_key = 'perdido'),
  'lost', '(c) confirmacao/perdido → lost');

SELECT is(
  (SELECT stage_role::text FROM public.pipeline_stages
    WHERE organization_id = '99099099-0000-0000-0000-000000000990'
      AND pipeline_type = 'whatsapp' AND stage_key = 'agendado'),
  'meeting_booked', '(c) whatsapp/agendado → meeting_booked');

SELECT is(
  (SELECT count(*)::int FROM public.pipeline_stages
    WHERE organization_id = '99099099-0000-0000-0000-000000000990'
      AND pipeline_type = 'confirmacao' AND stage_role = 'meeting_booked'),
  6, '(c) confirmacao: reuniao_marcada + d5/d3/d2/d1 + no_dia = 6 meeting_booked');

SELECT is(
  (SELECT stage_role::text FROM public.pipeline_stages
    WHERE organization_id = '99099099-0000-0000-0000-000000000990'
      AND pipeline_type = 'confirmacao' AND stage_key = 'compareceu'),
  'meeting_held', '(c) confirmacao/compareceu → meeting_held');

SELECT is(
  (SELECT stage_role::text FROM public.pipeline_stages
    WHERE organization_id = '99099099-0000-0000-0000-000000000990'
      AND pipeline_type = 'whatsapp' AND stage_key = 'compareceu'),
  'meeting_held', '(c) funil mergeado: whatsapp/compareceu → meeting_held');

SELECT is(
  (SELECT stage_role::text FROM public.pipeline_stages
    WHERE organization_id = '99099099-0000-0000-0000-000000000990'
      AND pipeline_type = 'whatsapp' AND stage_key = 'nao_compareceu'),
  'lost', '(c) funil mergeado: whatsapp/nao_compareceu → lost');

SELECT is(
  (SELECT count(*)::int FROM public.pipeline_stages
    WHERE organization_id = '99099099-0000-0000-0000-000000000990'
      AND pipeline_type = 'whatsapp'
      AND stage_key IN ('novo', 'abordado', 'respondeu', 'esfriou')
      AND stage_role = 'open'),
  4, '(c) whatsapp novo/abordado/respondeu/esfriou → open (nutrição)');

SELECT is(
  (SELECT count(*)::int FROM public.pipeline_stages
    WHERE organization_id = '99099099-0000-0000-0000-000000000990'
      AND pipeline_type LIKE 'upsell%'
      AND stage_role <> 'open'),
  0, '(c) upsell_base/upsell_gestao são buckets de carteira → todos open');

-- Cobertura total: nenhuma stage da org fixture diverge do mapa (a mesma
-- query de verificação commitada em rollback/*_verify.sql).
SELECT is(
  (SELECT count(*)::int FROM public.pipeline_stages
    WHERE organization_id = '99099099-0000-0000-0000-000000000990'
      AND stage_role IS DISTINCT FROM
          public.system_stage_role(pipeline_type, stage_key)),
  0, '(c) 100% de cobertura: zero divergências do mapa determinístico');

-- ---------------------------------------------------------------------------
-- (d) Custom fica open; role explícito no INSERT é respeitado
-- ---------------------------------------------------------------------------
INSERT INTO public.pipeline_stages
  (organization_id, pipeline_type, stage_key, name, color, position)
VALUES ('99099099-0000-0000-0000-000000000990', 'whatsapp',
        'etapa_custom_990', 'Minha Etapa Custom', '#888888', 92);

SELECT is(
  (SELECT stage_role::text FROM public.pipeline_stages
    WHERE organization_id = '99099099-0000-0000-0000-000000000990'
      AND stage_key = 'etapa_custom_990'),
  'open', '(d) stage custom (chave fora do mapa) fica open');

INSERT INTO public.pipeline_stages
  (organization_id, pipeline_type, stage_key, name, color, position, stage_role)
VALUES ('99099099-0000-0000-0000-000000000990', 'whatsapp',
        'etapa_custom_990b', 'Custom com role', '#888888', 93, 'meeting_held');

SELECT is(
  (SELECT stage_role::text FROM public.pipeline_stages
    WHERE organization_id = '99099099-0000-0000-0000-000000000990'
      AND stage_key = 'etapa_custom_990b'),
  'meeting_held', '(d) role explícito no INSERT não é sobrescrito pelo trigger');

-- ---------------------------------------------------------------------------
-- (b) Exclusividade por construção: valor fora do enum é rejeitado
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ UPDATE public.pipeline_stages
       SET stage_role = 'won_and_also_lost'
     WHERE organization_id = '99099099-0000-0000-0000-000000000990'
       AND pipeline_type = 'propostas' AND stage_key = 'vendido' $$,
  '22P02',  -- invalid_text_representation (invalid input value for enum)
  NULL,
  '(b) UPDATE para valor fora do enum FALHA — role é exclusivo por construção');

SELECT throws_ok(
  $$ UPDATE public.pipeline_stages
       SET stage_role = NULL
     WHERE organization_id = '99099099-0000-0000-0000-000000000990'
       AND pipeline_type = 'propostas' AND stage_key = 'vendido' $$,
  '23502',  -- not_null_violation
  NULL,
  '(b) UPDATE para NULL FALHA — toda stage sempre tem exatamente 1 role');

-- ---------------------------------------------------------------------------
-- (e) Renomear stage NÃO altera o role (razão de existir do ADR-0017:
--     rename jamais pode mover métrica)
-- ---------------------------------------------------------------------------
UPDATE public.pipeline_stages
SET name = 'Fechado & Ganho 🏆'
WHERE organization_id = '99099099-0000-0000-0000-000000000990'
  AND pipeline_type = 'propostas' AND stage_key = 'vendido';

SELECT is(
  (SELECT stage_role::text FROM public.pipeline_stages
    WHERE organization_id = '99099099-0000-0000-0000-000000000990'
      AND pipeline_type = 'propostas' AND stage_key = 'vendido'),
  'won', '(e) rename (name) preserva stage_role = won');

UPDATE public.pipeline_stages
SET position = 42
WHERE organization_id = '99099099-0000-0000-0000-000000000990'
  AND pipeline_type = 'propostas' AND stage_key = 'vendido';

SELECT is(
  (SELECT stage_role::text FROM public.pipeline_stages
    WHERE organization_id = '99099099-0000-0000-0000-000000000990'
      AND pipeline_type = 'propostas' AND stage_key = 'vendido'),
  'won', '(e) reorder (position) preserva stage_role = won');

-- ---------------------------------------------------------------------------
-- (f) RLS de pipeline_stages intacta
-- ---------------------------------------------------------------------------
SELECT ok(
  (SELECT relrowsecurity FROM pg_class
    WHERE oid = 'public.pipeline_stages'::regclass),
  '(f) RLS segue ENABLED em pipeline_stages');

SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'pipeline_stages'
             AND policyname = 'Users can view pipeline stages'),
  '(f) policy de SELECT tenant segue presente');

SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'pipeline_stages'
             AND policyname = 'Users can manage pipeline stages'),
  '(f) policy de manage tenant segue presente');

SELECT ok(
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'pipeline_stages') >= 3,
  '(f) conjunto de policies de pipeline_stages não encolheu (tenant + master)');

SELECT * FROM finish();

ROLLBACK;
