-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260703170252  name: carteira_recalc_client_metrics_trigger
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

CREATE OR REPLACE FUNCTION public.recalc_upsell_client_metrics(p_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org_id        uuid;
  v_org_default   int;
  v_order_count   int;
  v_total         numeric;
  v_avg           numeric;
  v_last          timestamptz;
  v_cycle         int;
  v_days_since    int;
  v_next          timestamptz;
  v_now           timestamptz := now();
BEGIN
  IF p_client_id IS NULL THEN
    RETURN;
  END IF;

  SELECT organization_id INTO v_org_id
  FROM upsell_clients WHERE id = p_client_id
  FOR UPDATE;

  IF v_org_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(default_reorder_cycle_days, 30) INTO v_org_default
  FROM organizations WHERE id = v_org_id;
  v_org_default := COALESCE(v_org_default, 30);

  SELECT count(*), COALESCE(sum(sale_value), 0), max(sold_at)
    INTO v_order_count, v_total, v_last
  FROM upsell_orders
  WHERE client_id = p_client_id
    AND approval_status = 'approved';

  v_avg := CASE
             WHEN v_order_count > 0 AND v_total > 0 THEN v_total / v_order_count
             ELSE NULL
           END;

  IF v_order_count < 2 THEN
    v_cycle := v_org_default;
  ELSE
    SELECT GREATEST(1, round(avg(gap_days))::int)
      INTO v_cycle
    FROM (
      SELECT EXTRACT(EPOCH FROM (
               sold_at - lag(sold_at) OVER (ORDER BY sold_at)
             )) / 86400.0 AS gap_days
      FROM upsell_orders
      WHERE client_id = p_client_id
        AND approval_status = 'approved'
    ) g
    WHERE gap_days IS NOT NULL;
    v_cycle := COALESCE(v_cycle, v_org_default);
  END IF;

  v_days_since := CASE
                    WHEN v_last IS NULL THEN 999
                    ELSE GREATEST(0, round(EXTRACT(EPOCH FROM (v_now - v_last)) / 86400.0)::int)
                  END;

  v_next := CASE
              WHEN v_last IS NULL THEN NULL
              ELSE v_last + (v_cycle || ' days')::interval
            END;

  UPDATE upsell_clients SET
    order_count           = v_order_count,
    lifetime_value        = v_total,
    avg_ticket            = v_avg,
    last_order_at         = v_last,
    reorder_cycle_days    = v_cycle,
    days_since_last_order = v_days_since,
    next_order_expected   = v_next,
    updated_at            = v_now
  WHERE id = p_client_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.recalc_upsell_client_metrics(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalc_upsell_client_metrics(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_upsell_order_recalc_metrics()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.approval_status = 'approved' THEN
      PERFORM public.recalc_upsell_client_metrics(NEW.client_id);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.approval_status = 'approved' THEN
      PERFORM public.recalc_upsell_client_metrics(OLD.client_id);
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.approval_status = 'approved' OR NEW.approval_status = 'approved' THEN
      PERFORM public.recalc_upsell_client_metrics(NEW.client_id);
      IF NEW.client_id IS DISTINCT FROM OLD.client_id THEN
        PERFORM public.recalc_upsell_client_metrics(OLD.client_id);
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_upsell_order_recalc_metrics ON public.upsell_orders;
CREATE TRIGGER trg_upsell_order_recalc_metrics
AFTER INSERT OR DELETE OR UPDATE OF approval_status, sale_value, sold_at, client_id
ON public.upsell_orders
FOR EACH ROW
EXECUTE FUNCTION public.trg_upsell_order_recalc_metrics();

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT id FROM (
      SELECT client_id AS id
      FROM upsell_orders
      WHERE approval_status = 'approved' AND client_id IS NOT NULL
      UNION
      SELECT id FROM upsell_clients WHERE order_count > 0
    ) t
  LOOP
    PERFORM public.recalc_upsell_client_metrics(r.id);
  END LOOP;
END;
$$;
