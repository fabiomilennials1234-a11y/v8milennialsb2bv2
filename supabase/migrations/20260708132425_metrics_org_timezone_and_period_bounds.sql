-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260708132425  name: metrics_org_timezone_and_period_bounds
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- 20270302000000 (#989, ADR-0017 §5)
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Sao_Paulo';
COMMENT ON COLUMN public.organizations.timezone IS 'IANA timezone of the org (ADR-0017 §5). Every Metric Period is cut in this zone, exclusively by the database (metric_period_bounds). Validated against pg_timezone_names on write.';

CREATE OR REPLACE FUNCTION public.is_valid_timezone(p_tz text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_tz); $$;
REVOKE ALL ON FUNCTION public.is_valid_timezone(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_valid_timezone(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_organization_timezone()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_valid_timezone(NEW.timezone) THEN
    RAISE EXCEPTION 'invalid organization timezone "%" — must be an IANA zone name (see pg_timezone_names)', NEW.timezone USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS organizations_validate_timezone ON public.organizations;
CREATE TRIGGER organizations_validate_timezone
  BEFORE INSERT OR UPDATE OF timezone ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.validate_organization_timezone();

CREATE OR REPLACE FUNCTION public.metric_period_bounds(
  p_org_id uuid, p_period text, p_ref date DEFAULT NULL, p_start date DEFAULT NULL, p_end date DEFAULT NULL
)
RETURNS tstzrange LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz text; v_ref date; v_start_local date; v_end_local date;
BEGIN
  SELECT o.timezone INTO v_tz FROM public.organizations o WHERE o.id = p_org_id;
  IF v_tz IS NULL THEN
    RAISE EXCEPTION 'metric_period_bounds: organization % not found', p_org_id USING ERRCODE = 'P0002';
  END IF;
  v_ref := COALESCE(p_ref, (now() AT TIME ZONE v_tz)::date);
  CASE p_period
    WHEN 'day' THEN v_start_local := v_ref; v_end_local := v_ref + 1;
    WHEN 'week' THEN v_start_local := date_trunc('week', v_ref::timestamp)::date; v_end_local := v_start_local + 7;
    WHEN 'month' THEN v_start_local := date_trunc('month', v_ref::timestamp)::date; v_end_local := (date_trunc('month', v_ref::timestamp) + interval '1 month')::date;
    WHEN 'range' THEN
      IF p_start IS NULL OR p_end IS NULL THEN RAISE EXCEPTION 'metric_period_bounds: period ''range'' requires p_start and p_end' USING ERRCODE = '22023'; END IF;
      IF p_end < p_start THEN RAISE EXCEPTION 'metric_period_bounds: p_end (%) before p_start (%)', p_end, p_start USING ERRCODE = '22023'; END IF;
      v_start_local := p_start; v_end_local := p_end + 1;
    ELSE RAISE EXCEPTION 'metric_period_bounds: unknown period "%" (expected day|week|month|range)', p_period USING ERRCODE = '22023';
  END CASE;
  RETURN tstzrange(v_start_local::timestamp AT TIME ZONE v_tz, v_end_local::timestamp AT TIME ZONE v_tz, '[)');
END;
$$;
COMMENT ON FUNCTION public.metric_period_bounds(uuid, text, date, date, date) IS 'ADR-0017 §5 / #989: resolves a NAMED period (day|week|month|range) into a half-open [start,end) tstzrange cut in the organization''s timezone. The single source of period boundaries — frontend and RPCs must never compute period cuts themselves.';
REVOKE ALL ON FUNCTION public.metric_period_bounds(uuid, text, date, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.metric_period_bounds(uuid, text, date, date, date) TO authenticated, service_role;
