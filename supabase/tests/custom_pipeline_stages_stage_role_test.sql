-- supabase/tests/custom_pipeline_stages_stage_role_test.sql
--
-- U1 (ADR-0017 §1 / #990 extension) — STAGE_ROLE GOVERNANCE reaches CUSTOM
-- pipelines. custom_pipeline_stages gains stage_role (+ suggestion columns +
-- money guard); metric_stage_role() resolves custom stages via the real join
-- keys (custom_pipeline_stages.pipeline_id + stage_key), so custom-funnel
-- sales finally emit sale_events. Mirrors pipeline_stages governance (#990/#991)
-- and the won/lost money guard (FIX-4).
--
-- Run (CI): after `supabase start`, via supabase/tests/run.sh.
-- Run (direct): psql "$DATABASE_URL" -f supabase/tests/custom_pipeline_stages_stage_role_test.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(22);

-- ===========================================================================
-- FIXTURES — org + users (admin/membro/master) + SYSTEM pipeline + CUSTOM
-- pipeline (open + won stages) + lead. Seeded privileged (postgres) so the
-- won money-guard (added by this migration) does not block the seed.
-- ===========================================================================
SET LOCAL role postgres;

-- Tenant scaffolding without auto-triggers / auth.users FK (replica).
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug)
VALUES ('a1000000-0000-0000-0000-000000000001', 'Org U1 custom governance', 'org-u1-custom');

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('a1000000-aaaa-2222-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'a1000000-aaaa-1111-0000-000000000001', 'Admin U1',  'admin',  true),
  ('a1000000-bbbb-2222-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'a1000000-bbbb-1111-0000-000000000001', 'Member U1', 'member', true);

-- master SEM team_member na org (prova o path master, não o de admin).
INSERT INTO public.master_users (user_id, is_active)
VALUES ('a1000000-cccc-1111-0000-000000000001', true);

INSERT INTO public.leads (id, organization_id, name, sale_responsible_id)
VALUES ('a1000000-1ead-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Lead U1', 'a1000000-aaaa-1111-0000-000000000001');

SET LOCAL session_replication_role = origin;  -- triggers ON (sync + capture + system map)

-- Contexto de BACKEND a partir daqui (SCRUM-361).
--
-- A semeadura abaixo cria etapa won/lost, e `fn_pipeline_stages_guard_money_role`
-- (ADR-0017 §1) recusa isso fora de backend/master/admin. O erro é P0001 e aborta
-- o arquivo — vira "Bad plan. You planned N tests but ran M".
--
-- O comentario que estava aqui dizia "como superusuario". Isso NUNCA foi verdade:
-- medido em producao, `postgres` tem rolsuper=false (so `supabase_admin` e
-- superusuario), entao o ramo `rolsuper` do guard nunca disparou. O caminho
-- privilegiado REAL e o backend — em producao quem semeia funil e a edge function
-- de provisionamento, com service_role.
--
-- As secoes de membro e de master mais abaixo trocam de papel explicitamente, e
-- sao elas que provam a NEGACAO. Esta linha nao as afeta.
SET LOCAL role service_role;

-- SYSTEM pipeline (propostas): pipeline_stages governa via system_stage_role.
INSERT INTO public.pipelines (id, organization_id, name, slug, type)
VALUES ('a1000000-5451-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Propostas', 'propostas', 'system');
INSERT INTO public.pipeline_stages (organization_id, pipeline_type, stage_key, name, position) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'propostas', 'proposta_enviada', 'Proposta enviada', 1),
  ('a1000000-0000-0000-0000-000000000001', 'propostas', 'vendido', 'Vendido', 2);  -- → won via system map

-- CUSTOM pipeline: insert fires sync_custom_pipeline_to_pipelines → pipelines(type=custom).
INSERT INTO public.custom_pipelines (id, organization_id, name, slug, position)
VALUES ('a1000000-c057-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Funil Custom', 'funil-custom', 0);

-- CUSTOM stages: 'novo' stays open (default); 'fechado' governed won (seed privileged).
INSERT INTO public.custom_pipeline_stages (id, organization_id, pipeline_id, stage_key, name, position) VALUES
  ('a1000000-c5a6-0000-0000-00000000000e', 'a1000000-0000-0000-0000-000000000001', 'a1000000-c057-0000-0000-000000000001', 'novo', 'Novo', 0);
INSERT INTO public.custom_pipeline_stages (id, organization_id, pipeline_id, stage_key, name, position, stage_role) VALUES
  ('a1000000-c5a6-0000-0000-00000000000f', 'a1000000-0000-0000-0000-000000000001', 'a1000000-c057-0000-0000-000000000001', 'fechado', 'Fechado', 1, 'won');

-- ---------------------------------------------------------------------------
-- (1) Tracer — custom_pipeline_stages carries stage_role NOT NULL DEFAULT 'open'
-- ---------------------------------------------------------------------------
SELECT col_default_is(
  'public', 'custom_pipeline_stages', 'stage_role', 'open',
  '(1) custom_pipeline_stages.stage_role default is open');

-- ---------------------------------------------------------------------------
-- (2) metric_stage_role resolves a CUSTOM stage via the real join keys
-- ---------------------------------------------------------------------------
SELECT is(
  public.metric_stage_role(
    'a1000000-0000-0000-0000-000000000001',
    'a1000000-c057-0000-0000-000000000001',   -- custom pipeline_id (= pipelines.id mirror)
    'fechado')::text,
  'won',
  '(2) metric_stage_role resolves custom stage governed as won');

-- ---------------------------------------------------------------------------
-- (3) SYSTEM pipeline STILL resolves via pipeline_stages (no regression)
-- ---------------------------------------------------------------------------
SELECT is(
  public.metric_stage_role(
    'a1000000-0000-0000-0000-000000000001',
    'a1000000-5451-0000-0000-000000000001',   -- system pipeline (propostas)
    'vendido')::text,
  'won',
  '(3) system pipeline vendido still resolves won via pipeline_stages');

SELECT is(
  public.metric_stage_role(
    'a1000000-0000-0000-0000-000000000001',
    'a1000000-5451-0000-0000-000000000001',
    'proposta_enviada')::text,
  'open',
  '(3) system pipeline open stage still resolves open');

-- ---------------------------------------------------------------------------
-- (4) Custom stage left 'open' → 'open'; a stage with NO governance row → NULL
-- ---------------------------------------------------------------------------
SELECT is(
  public.metric_stage_role(
    'a1000000-0000-0000-0000-000000000001',
    'a1000000-c057-0000-0000-000000000001',
    'novo')::text,
  'open',
  '(4) custom open stage resolves open (governed, not sale)');

SELECT ok(
  public.metric_stage_role(
    'a1000000-0000-0000-0000-000000000001',
    'a1000000-c057-0000-0000-000000000001',
    'stage_que_nao_existe') IS NULL,
  '(4) custom stage with no governance row resolves NULL');

-- ---------------------------------------------------------------------------
-- (5) END-TO-END: lead entering a custom OPEN stage emits NO sale; moving into
--     a custom WON stage emits exactly one sale_event (event_type='sale') via
--     custom_pipe_entries → pipeline_entries → pipeline_stage_events → sale_events.
-- ---------------------------------------------------------------------------
-- Entry into the open stage 'novo' (fires sync → entry → stage_event → capture).
INSERT INTO public.custom_pipe_entries (id, organization_id, pipeline_id, lead_id, stage_id)
VALUES ('a1000000-e457-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001',
        'a1000000-c057-0000-0000-000000000001', 'a1000000-1ead-0000-0000-000000000001',
        'a1000000-c5a6-0000-0000-00000000000e');   -- 'novo' (open)

SELECT is(
  (SELECT count(*)::int FROM public.sale_events
   WHERE lead_id = 'a1000000-1ead-0000-0000-000000000001'),
  0,
  '(5) entering a custom OPEN stage emits no sale_event');

-- Move to the won stage 'fechado' (sync UPDATE → entry stage_key → stage_event → capture).
UPDATE public.custom_pipe_entries
  SET stage_id = 'a1000000-c5a6-0000-0000-00000000000f'   -- 'fechado' (won)
  WHERE id = 'a1000000-e457-0000-0000-000000000001';

SELECT is(
  (SELECT count(*)::int FROM public.sale_events
   WHERE lead_id = 'a1000000-1ead-0000-0000-000000000001'
     AND event_type = 'sale'
     AND pipeline_id = 'a1000000-c057-0000-0000-000000000001'),
  1,
  '(5) moving a lead into a custom WON stage emits one sale_event (event_type=sale)');

-- ---------------------------------------------------------------------------
-- (6) MONEY GUARD on custom_pipeline_stages — won/lost is money (ADR-0017 §1).
--     Non-admin member blocked (P0001); open/meeting_* free; admin/master/
--     service_role allowed. RLS lets a member write the row; the trigger gates
--     the money role (RLS can't distinguish admin from member on this column).
-- ---------------------------------------------------------------------------
-- Structure: guard + trigger exist, trigger fires on custom_pipeline_stages.
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_custom_pipeline_stages_won_lost_guard'
      AND tgrelid = 'public.custom_pipeline_stages'::regclass
      AND NOT tgisinternal
  ),
  '(6) guard trigger trg_custom_pipeline_stages_won_lost_guard on custom_pipeline_stages');

-- ── MEMBRO (não-admin) ──────────────────────────────────────────────────────
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a1000000-bbbb-1111-0000-000000000001","role":"authenticated"}', true);

SELECT throws_ok(
  $$ INSERT INTO public.custom_pipeline_stages
       (organization_id, pipeline_id, stage_key, name, position, stage_role)
     VALUES ('a1000000-0000-0000-0000-000000000001', 'a1000000-c057-0000-0000-000000000001',
             'guard_member_won', 'Membro tentou won', 90, 'won') $$,
  'P0001', NULL,
  '(6) membro NÃO pode INSERT stage_role=won em custom');

SELECT throws_ok(
  $$ INSERT INTO public.custom_pipeline_stages
       (organization_id, pipeline_id, stage_key, name, position, stage_role)
     VALUES ('a1000000-0000-0000-0000-000000000001', 'a1000000-c057-0000-0000-000000000001',
             'guard_member_lost', 'Membro tentou lost', 91, 'lost') $$,
  'P0001', NULL,
  '(6) membro NÃO pode INSERT stage_role=lost em custom');

SELECT throws_ok(
  $$ UPDATE public.custom_pipeline_stages SET stage_role = 'won'
     WHERE id = 'a1000000-c5a6-0000-0000-00000000000e' $$,   -- 'novo' open→won
  'P0001', NULL,
  '(6) membro NÃO pode UPDATE open→won em custom');

SELECT lives_ok(
  $$ INSERT INTO public.custom_pipeline_stages
       (organization_id, pipeline_id, stage_key, name, position)
     VALUES ('a1000000-0000-0000-0000-000000000001', 'a1000000-c057-0000-0000-000000000001',
             'guard_member_open', 'Membro etapa open', 92) $$,
  '(6) membro PODE INSERT etapa open (não-dinheiro) em custom');

SELECT lives_ok(
  $$ INSERT INTO public.custom_pipeline_stages
       (organization_id, pipeline_id, stage_key, name, position, stage_role)
     VALUES ('a1000000-0000-0000-0000-000000000001', 'a1000000-c057-0000-0000-000000000001',
             'guard_member_meet', 'Membro etapa reunião', 93, 'meeting_held') $$,
  '(6) membro PODE INSERT meeting_held (não-dinheiro) em custom');

-- ── ADMIN da org ────────────────────────────────────────────────────────────
SET LOCAL role postgres;
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a1000000-aaaa-1111-0000-000000000001","role":"authenticated"}', true);

SELECT lives_ok(
  $$ INSERT INTO public.custom_pipeline_stages
       (organization_id, pipeline_id, stage_key, name, position, stage_role)
     VALUES ('a1000000-0000-0000-0000-000000000001', 'a1000000-c057-0000-0000-000000000001',
             'guard_admin_won', 'Admin definiu won', 94, 'won') $$,
  '(6) admin da org PODE INSERT stage_role=won em custom');

-- ── MASTER (sem team_member na org) ─────────────────────────────────────────
SET LOCAL role postgres;
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a1000000-cccc-1111-0000-000000000001","role":"authenticated"}', true);

SELECT lives_ok(
  $$ INSERT INTO public.custom_pipeline_stages
       (organization_id, pipeline_id, stage_key, name, position, stage_role)
     VALUES ('a1000000-0000-0000-0000-000000000001', 'a1000000-c057-0000-0000-000000000001',
             'guard_master_won', 'Master definiu won', 95, 'won') $$,
  '(6) master (sem team_member) PODE INSERT stage_role=won em custom');

-- ── service_role (backend/classifier/seed) ──────────────────────────────────
SET LOCAL role postgres;
SET LOCAL role service_role;

SELECT lives_ok(
  $$ INSERT INTO public.custom_pipeline_stages
       (organization_id, pipeline_id, stage_key, name, position, stage_role)
     VALUES ('a1000000-0000-0000-0000-000000000001', 'a1000000-c057-0000-0000-000000000001',
             'guard_service_won', 'Backend definiu won', 96, 'won') $$,
  '(6) service_role PODE INSERT stage_role=won em custom (path classifier/seed)');

SET LOCAL role postgres;

-- ---------------------------------------------------------------------------
-- (7) SUGGESTION columns mirror pipeline_stages (#991): same columns + same
--     CHECKs (suggested_role ≠ 'open'; source ∈ deterministic|ai|flag).
-- ---------------------------------------------------------------------------
SELECT has_column('public', 'custom_pipeline_stages', 'suggested_stage_role',
  '(7) custom_pipeline_stages.suggested_stage_role exists');
SELECT has_column('public', 'custom_pipeline_stages', 'stage_role_suggestion_source',
  '(7) custom_pipeline_stages.stage_role_suggestion_source exists');

SELECT throws_ok(
  $$ INSERT INTO public.custom_pipeline_stages
       (organization_id, pipeline_id, stage_key, name, position, suggested_stage_role)
     VALUES ('a1000000-0000-0000-0000-000000000001', 'a1000000-c057-0000-0000-000000000001',
             'sug_open', 'Sugestão open', 97, 'open') $$,
  '23514', NULL,
  '(7) suggested_stage_role = open viola o CHECK not_open');

SELECT throws_ok(
  $$ INSERT INTO public.custom_pipeline_stages
       (organization_id, pipeline_id, stage_key, name, position, stage_role_suggestion_source)
     VALUES ('a1000000-0000-0000-0000-000000000001', 'a1000000-c057-0000-0000-000000000001',
             'sug_badsrc', 'Fonte inválida', 98, 'telepatia') $$,
  '23514', NULL,
  '(7) stage_role_suggestion_source fora de {deterministic,ai,flag} viola o CHECK');

SELECT lives_ok(
  $$ INSERT INTO public.custom_pipeline_stages
       (organization_id, pipeline_id, stage_key, name, position,
        suggested_stage_role, stage_role_suggestion_source, stage_role_suggested_at)
     VALUES ('a1000000-0000-0000-0000-000000000001', 'a1000000-c057-0000-0000-000000000001',
             'sug_ok', 'Sugestão pendente won', 99, 'won', 'ai', now()) $$,
  '(7) suggested won via source=ai é aceito (pendência de revisão humana)');

SELECT * FROM finish();

ROLLBACK;
