-- 20270302000000_org_timezone_and_metric_period_bounds.sql
--
-- Issue #989 (PRD #986) — Metric Period foundation, ADR-0017 §5:
-- "Periods cut in the Organization's timezone — period boundaries resolved
--  exclusively by the database; the frontend names periods and never
--  converts dates."
--
-- Ships:
--   1. organizations.timezone           text NOT NULL DEFAULT 'America/Sao_Paulo'
--   2. is_valid_timezone(text)          IANA-name validation helper
--   3. trg organizations_validate_timezone  write-time timezone validation
--   4. metric_period_bounds(...)        THE single period-cutting function
--
-- Why a validation TRIGGER instead of a CHECK constraint (or a DOMAIN):
--   IANA zone validity is defined by the tzdata the server currently runs,
--   surfaced by pg_timezone_names — a view over runtime state, not a stable
--   set. A CHECK constraint must behave as immutable: it is re-evaluated when
--   data is reloaded (pg_dump/pg_restore, ALTER ... VALIDATE), so a CHECK
--   whose truth depends on tzdata would make a restore fail the day a zone is
--   renamed/retired by a tzdata update (this happens in practice). A DOMAIN
--   CHECK has the identical non-immutability problem. A BEFORE trigger gives
--   the semantics we actually want: every WRITE is validated against the LIVE
--   tzdata, while rows already stored are never re-judged.

-- ----------------------------------------------------------------------------
-- 1. Column
-- ----------------------------------------------------------------------------
-- Single-statement ADD COLUMN ... NOT NULL DEFAULT is safe on PG11+ (no table
-- rewrite; default is stamped in the catalog and backfilled lazily).
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Sao_Paulo';

COMMENT ON COLUMN public.organizations.timezone IS
  'IANA timezone of the org (ADR-0017 §5). Every Metric Period is cut in this zone, exclusively by the database (metric_period_bounds). Validated against pg_timezone_names on write.';

-- ----------------------------------------------------------------------------
-- 2. Validation helper
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_valid_timezone(p_tz text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  -- Exact match against pg_timezone_names: accepts canonical IANA names
  -- ('America/Sao_Paulo', 'UTC', ...) and rejects bare offsets ('+03',
  -- 'UTC-5') that AT TIME ZONE would tolerate but that are not org timezones
  -- (they would silently ignore DST rules). pg_timezone_names is a full
  -- tzdata scan (~milliseconds) — acceptable: this only runs on org writes.
  SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_tz);
$$;

REVOKE ALL ON FUNCTION public.is_valid_timezone(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_valid_timezone(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_organization_timezone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_valid_timezone(NEW.timezone) THEN
    RAISE EXCEPTION 'invalid organization timezone "%" — must be an IANA zone name (see pg_timezone_names)', NEW.timezone
      USING ERRCODE = '22023';  -- invalid_parameter_value
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizations_validate_timezone ON public.organizations;
CREATE TRIGGER organizations_validate_timezone
  BEFORE INSERT OR UPDATE OF timezone ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_organization_timezone();

-- ----------------------------------------------------------------------------
-- 3. metric_period_bounds — the ONLY place period boundaries are computed
-- ----------------------------------------------------------------------------
-- Contract (ADR-0017 §5): callers NAME a period; this function cuts it in the
-- org's timezone and returns a half-open [start, end) tstzrange. Metric RPCs
-- consume it as: WHERE sold_at <@ metric_period_bounds(org, 'month', ref).
--
--   p_period = 'day'   → the calendar day p_ref (org tz)
--   p_period = 'week'  → ISO week (Mon–Sun) containing p_ref (org tz)
--   p_period = 'month' → calendar month containing p_ref (org tz)
--   p_period = 'range' → [p_start .. p_end] inclusive calendar dates (org tz)
--   p_ref NULL         → "today" in the org's timezone
--
-- Half-open [start, end) is deliberate: adjacent periods tile with no gap and
-- no double-count (the legacy `- interval '1 second'` idiom loses events in
-- the final second of every period).
--
-- SECURITY DEFINER: metric RPCs run under both authenticated (RLS on) and
-- service_role/cron contexts; this function must resolve the org timezone in
-- either. It reads ONLY organizations.timezone and returns time boundaries —
-- no tenant data crosses the boundary. Tenant access control remains the
-- calling RPC's responsibility (assert_org_access / RLS), same model as the
-- existing metric RPCs.
CREATE OR REPLACE FUNCTION public.metric_period_bounds(
  p_org_id uuid,
  p_period text,
  p_ref    date DEFAULT NULL,
  p_start  date DEFAULT NULL,
  p_end    date DEFAULT NULL
)
RETURNS tstzrange
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz          text;
  v_ref         date;
  v_start_local date;  -- inclusive, org-local calendar date
  v_end_local   date;  -- exclusive, org-local calendar date
BEGIN
  SELECT o.timezone INTO v_tz
  FROM public.organizations o
  WHERE o.id = p_org_id;

  IF v_tz IS NULL THEN
    RAISE EXCEPTION 'metric_period_bounds: organization % not found', p_org_id
      USING ERRCODE = 'P0002';  -- no_data_found
  END IF;

  -- "today" is only meaningful in the org's own timezone.
  v_ref := COALESCE(p_ref, (now() AT TIME ZONE v_tz)::date);

  CASE p_period
    WHEN 'day' THEN
      v_start_local := v_ref;
      v_end_local   := v_ref + 1;
    WHEN 'week' THEN
      -- date_trunc('week') is ISO: Monday start.
      v_start_local := date_trunc('week', v_ref::timestamp)::date;
      v_end_local   := v_start_local + 7;
    WHEN 'month' THEN
      v_start_local := date_trunc('month', v_ref::timestamp)::date;
      v_end_local   := (date_trunc('month', v_ref::timestamp) + interval '1 month')::date;
    WHEN 'range' THEN
      IF p_start IS NULL OR p_end IS NULL THEN
        RAISE EXCEPTION 'metric_period_bounds: period ''range'' requires p_start and p_end'
          USING ERRCODE = '22023';
      END IF;
      IF p_end < p_start THEN
        RAISE EXCEPTION 'metric_period_bounds: p_end (%) before p_start (%)', p_end, p_start
          USING ERRCODE = '22023';
      END IF;
      v_start_local := p_start;
      v_end_local   := p_end + 1;  -- p_end is an inclusive named date
    ELSE
      RAISE EXCEPTION 'metric_period_bounds: unknown period "%" (expected day|week|month|range)', p_period
        USING ERRCODE = '22023';
  END CASE;

  -- local wall-clock midnight → absolute instant in the org's zone (DST-safe).
  RETURN tstzrange(
    v_start_local::timestamp AT TIME ZONE v_tz,
    v_end_local::timestamp   AT TIME ZONE v_tz,
    '[)'
  );
END;
$$;

COMMENT ON FUNCTION public.metric_period_bounds(uuid, text, date, date, date) IS
  'ADR-0017 §5 / #989: resolves a NAMED period (day|week|month|range) into a half-open [start,end) tstzrange cut in the organization''s timezone. The single source of period boundaries — frontend and RPCs must never compute period cuts themselves.';

REVOKE ALL ON FUNCTION public.metric_period_bounds(uuid, text, date, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.metric_period_bounds(uuid, text, date, date, date) TO authenticated, service_role;
