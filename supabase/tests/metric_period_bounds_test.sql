-- supabase/tests/metric_period_bounds_test.sql
--
-- ISSUE #989 (PRD #986, ADR-0017 §5) — pgTAP coverage for the Metric Period
-- foundation: organizations.timezone + metric_period_bounds().
--
-- Run:
--   supabase test db            # runs every *_test.sql under supabase/tests/
-- or directly against a local stack:
--   psql "$DATABASE_URL" -f supabase/tests/metric_period_bounds_test.sql
-- or with pg_prove:
--   pg_prove -d "$DATABASE_URL" supabase/tests/metric_period_bounds_test.sql
--
-- Asserts:
--   (a) structure — column, default, NOT NULL, function, validation trigger
--   (b) privileges — anon cannot EXECUTE metric_period_bounds; authenticated can
--   (c) validation — invalid IANA name and bare offsets rejected on write
--   (d) acceptance (issue #989) — a sale at 2026-06-30 23:30 America/Sao_Paulo
--       counts in June; 2026-07-01 01:00 UTC (= 2026-06-30 22:00 SP) counts in
--       June; the SP-midnight boundary instant belongs to July (half-open)
--   (e) day/week/range cuts, and orgs on alternative timezones
--       (America/Manaus, UTC) cut the SAME instant into DIFFERENT periods
--
-- All timestamps are written with explicit UTC offsets so the session
-- timezone is irrelevant. America/Sao_Paulo = UTC-3 year-round (DST abolished
-- 2019); America/Manaus = UTC-4 year-round.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(27);

-- ---------------------------------------------------------------------------
-- Fixtures: three orgs — SP (column default), Manaus, UTC.
-- Seed under replica replication role (proven repo pattern) so unrelated
-- triggers don't interfere; the validation trigger is exercised explicitly
-- in section (c) with normal trigger behavior restored.
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug)
VALUES ('11111111-0989-0000-0000-000000000001', 'Org SP (#989 test)', 'tz-test-sp-989')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organizations (id, name, slug, timezone)
VALUES
  ('22222222-0989-0000-0000-000000000002', 'Org Manaus (#989 test)', 'tz-test-manaus-989', 'America/Manaus'),
  ('33333333-0989-0000-0000-000000000003', 'Org UTC (#989 test)',    'tz-test-utc-989',    'UTC')
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- (a) structure
-- ---------------------------------------------------------------------------
SELECT has_column('public', 'organizations', 'timezone',
  '(a) organizations.timezone column exists');

SELECT col_not_null('public', 'organizations', 'timezone',
  '(a) organizations.timezone is NOT NULL');

SELECT is(
  (SELECT timezone FROM public.organizations
    WHERE id = '11111111-0989-0000-0000-000000000001'),
  'America/Sao_Paulo',
  '(a) default America/Sao_Paulo applied to org inserted without timezone');

SELECT has_function('public', 'metric_period_bounds',
  ARRAY['uuid', 'text', 'date', 'date', 'date'],
  '(a) metric_period_bounds(uuid,text,date,date,date) exists');

SELECT has_trigger('public', 'organizations', 'organizations_validate_timezone',
  '(a) timezone validation trigger exists on organizations');

-- ---------------------------------------------------------------------------
-- (b) privileges
-- ---------------------------------------------------------------------------
SELECT ok(
  NOT has_function_privilege('anon',
    'public.metric_period_bounds(uuid,text,date,date,date)', 'EXECUTE'),
  '(b) anon CANNOT execute metric_period_bounds');

SELECT ok(
  has_function_privilege('authenticated',
    'public.metric_period_bounds(uuid,text,date,date,date)', 'EXECUTE'),
  '(b) authenticated CAN execute metric_period_bounds');

-- ---------------------------------------------------------------------------
-- (c) write-time timezone validation (live tzdata, trigger-enforced)
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ UPDATE public.organizations
       SET timezone = 'America/Nowhere'
     WHERE id = '11111111-0989-0000-0000-000000000001' $$,
  '22023',
  NULL,
  '(c) invalid IANA name is REJECTED');

SELECT throws_ok(
  $$ UPDATE public.organizations
       SET timezone = 'UTC-5'
     WHERE id = '11111111-0989-0000-0000-000000000001' $$,
  '22023',
  NULL,
  '(c) bare offset spelling is REJECTED (must be a named zone)');

SELECT lives_ok(
  $$ UPDATE public.organizations
       SET timezone = 'America/Sao_Paulo'
     WHERE id = '11111111-0989-0000-0000-000000000001' $$,
  '(c) valid IANA name is ACCEPTED');

-- ---------------------------------------------------------------------------
-- (d) acceptance — month cut in America/Sao_Paulo (UTC-3)
-- ---------------------------------------------------------------------------
SELECT is(
  lower(public.metric_period_bounds(
    '11111111-0989-0000-0000-000000000001', 'month', '2026-06-15')),
  '2026-06-01 03:00:00+00'::timestamptz,
  '(d) June/SP lower bound = 2026-06-01 00:00 SP (= 03:00 UTC), inclusive');

SELECT ok(
  public.metric_period_bounds(
    '11111111-0989-0000-0000-000000000001', 'month', '2026-06-15')
    @> '2026-07-01 02:30:00+00'::timestamptz,
  '(d) sale at 2026-06-30 23:30 America/Sao_Paulo counts in JUNE');

SELECT ok(
  public.metric_period_bounds(
    '11111111-0989-0000-0000-000000000001', 'month', '2026-06-15')
    @> '2026-07-01 01:00:00+00'::timestamptz,
  '(d) sale at 2026-07-01 01:00 UTC (= 2026-06-30 22:00 SP) counts in JUNE');

SELECT ok(
  NOT (public.metric_period_bounds(
    '11111111-0989-0000-0000-000000000001', 'month', '2026-06-15')
    @> '2026-07-01 03:00:00+00'::timestamptz),
  '(d) SP midnight of July 1st is NOT in June (upper bound exclusive)');

SELECT ok(
  public.metric_period_bounds(
    '11111111-0989-0000-0000-000000000001', 'month', '2026-07-15')
    @> '2026-07-01 03:00:00+00'::timestamptz,
  '(d) ... and the SAME instant IS in July — periods tile with no gap');

-- ---------------------------------------------------------------------------
-- (e) day / week / range cuts
-- ---------------------------------------------------------------------------
SELECT ok(
  public.metric_period_bounds(
    '11111111-0989-0000-0000-000000000001', 'day', '2026-06-30')
    @> '2026-07-01 01:00:00+00'::timestamptz,
  '(e) day 2026-06-30/SP contains 2026-06-30 22:00 SP (day-border, UTC next day)');

SELECT ok(
  NOT (public.metric_period_bounds(
    '11111111-0989-0000-0000-000000000001', 'day', '2026-06-30')
    @> '2026-06-30 02:00:00+00'::timestamptz),
  '(e) day 2026-06-30/SP excludes 2026-06-29 23:00 SP (previous local day)');

SELECT is(
  lower(public.metric_period_bounds(
    '11111111-0989-0000-0000-000000000001', 'week', '2026-07-07')),
  '2026-07-06 03:00:00+00'::timestamptz,
  '(e) week of Tue 2026-07-07/SP starts Monday 2026-07-06 00:00 SP (ISO week)');

SELECT is(
  public.metric_period_bounds(
    '11111111-0989-0000-0000-000000000001', 'range', NULL, '2026-06-01', '2026-06-30'),
  public.metric_period_bounds(
    '11111111-0989-0000-0000-000000000001', 'month', '2026-06-15'),
  '(e) range 2026-06-01..2026-06-30 (inclusive end) equals the June month cut');

-- ---------------------------------------------------------------------------
-- (e) alternative timezones — same instant, different periods per org
-- ---------------------------------------------------------------------------
-- 2026-07-01 03:30 UTC = 2026-06-30 23:30 in Manaus (UTC-4) = 00:30 July in SP.
SELECT ok(
  public.metric_period_bounds(
    '22222222-0989-0000-0000-000000000002', 'month', '2026-06-15')
    @> '2026-07-01 03:30:00+00'::timestamptz,
  '(e) Manaus org: 2026-06-30 23:30 Manaus counts in JUNE');

SELECT ok(
  NOT (public.metric_period_bounds(
    '11111111-0989-0000-0000-000000000001', 'month', '2026-06-15')
    @> '2026-07-01 03:30:00+00'::timestamptz),
  '(e) SP org: the SAME instant is already JULY (00:30 SP)');

SELECT ok(
  NOT (public.metric_period_bounds(
    '33333333-0989-0000-0000-000000000003', 'month', '2026-06-15')
    @> '2026-07-01 01:00:00+00'::timestamptz),
  '(e) UTC org: 2026-07-01 01:00 UTC is NOT June');

SELECT ok(
  public.metric_period_bounds(
    '33333333-0989-0000-0000-000000000003', 'month', '2026-07-15')
    @> '2026-07-01 01:00:00+00'::timestamptz,
  '(e) UTC org: 2026-07-01 01:00 UTC IS July');

-- ---------------------------------------------------------------------------
-- error contract
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ SELECT public.metric_period_bounds(
       '11111111-0989-0000-0000-000000000001', 'quarter', '2026-06-15') $$,
  '22023',
  NULL,
  'unknown period name throws invalid_parameter_value');

SELECT throws_ok(
  $$ SELECT public.metric_period_bounds(
       '11111111-0989-0000-0000-000000000001', 'range', NULL, '2026-06-01', NULL) $$,
  '22023',
  NULL,
  'range without p_end throws invalid_parameter_value');

SELECT throws_ok(
  $$ SELECT public.metric_period_bounds(
       '11111111-0989-0000-0000-000000000001', 'range', NULL, '2026-06-30', '2026-06-01') $$,
  '22023',
  NULL,
  'range with p_end < p_start throws invalid_parameter_value');

SELECT throws_ok(
  $$ SELECT public.metric_period_bounds(
       '00000000-0000-0000-0000-0000000000ff', 'month', '2026-06-15') $$,
  'P0002',
  NULL,
  'unknown organization throws no_data_found');

SELECT * FROM finish();

ROLLBACK;
