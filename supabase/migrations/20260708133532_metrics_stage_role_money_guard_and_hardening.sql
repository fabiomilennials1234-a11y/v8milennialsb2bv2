-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260708133532  name: metrics_stage_role_money_guard_and_hardening
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- 20270302000090 (FIX-4/5/6) — comments de produtividade OMITIDOS (RPCs #080 deferidas em prod)
CREATE OR REPLACE FUNCTION public.fn_pipeline_stages_guard_money_role()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.stage_role IS DISTINCT FROM 'won' AND NEW.stage_role IS DISTINCT FROM 'lost' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.stage_role IS NOT DISTINCT FROM NEW.stage_role THEN
    RETURN NEW;
  END IF;
  IF coalesce(auth.role(), '') = 'service_role'
     OR current_user = 'service_role'
     OR coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR public.is_master_user()
     OR NEW.organization_id IN (SELECT public.get_my_admin_organization_ids()) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'access_denied: stage_role % é dinheiro (ADR-0017 §1) — só admin da org ou master pode definir/alterar won/lost', NEW.stage_role USING ERRCODE = 'P0001';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_pipeline_stages_guard_money_role() FROM PUBLIC;
COMMENT ON FUNCTION public.fn_pipeline_stages_guard_money_role() IS 'ADR-0017 §1 / FIX-4 — barra escrita de stage_role won/lost (dinheiro) por membro não-admin. Libera backend/master/admin da org.';
DROP TRIGGER IF EXISTS trg_pipeline_stages_won_lost_guard ON public.pipeline_stages;
CREATE TRIGGER trg_pipeline_stages_won_lost_guard
  BEFORE INSERT OR UPDATE ON public.pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION public.fn_pipeline_stages_guard_money_role();

CREATE OR REPLACE FUNCTION public.fn_sale_events_force_sold_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.source = 'trigger' THEN NEW.sold_at := now(); END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_funnel_flow(
  p_org_id uuid, p_pipeline_id uuid, p_period text, p_ref date DEFAULT NULL, p_start date DEFAULT NULL, p_end date DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_bounds tstzrange; v_cohort_size integer;
  v_reached_open integer; v_reached_book integer; v_reached_held integer; v_reached_won integer;
  v_lost_count integer; v_pre_cutover boolean;
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  IF p_pipeline_id IS NULL THEN
    RAISE EXCEPTION 'get_funnel_flow: p_pipeline_id é obrigatório (funil é por-pipeline)' USING ERRCODE = '22023';
  END IF;
  v_bounds := public.metric_period_bounds(p_org_id, p_period, p_ref, p_start, p_end);
  WITH pipe_events AS (
    SELECT e.lead_id, e.from_stage_key, e.occurred_at,
      public.metric_stage_role(p_org_id, p_pipeline_id, e.to_stage_key) AS role
    FROM public.pipeline_stage_events e
    WHERE e.organization_id = p_org_id AND e.pipeline_id = p_pipeline_id
  ),
  entry AS (
    SELECT pe.lead_id, COALESCE(min(pe.occurred_at) FILTER (WHERE pe.from_stage_key IS NULL), min(pe.occurred_at)) AS entry_at
    FROM pipe_events pe GROUP BY pe.lead_id
  ),
  cohort AS (SELECT en.lead_id FROM entry en WHERE en.entry_at <@ v_bounds),
  lead_reach AS (
    SELECT pe.lead_id,
      max(CASE pe.role WHEN 'meeting_booked' THEN 1 WHEN 'meeting_held' THEN 2 WHEN 'won' THEN 3 ELSE 0 END) AS max_rank,
      bool_or(pe.role = 'lost') AS ever_lost
    FROM pipe_events pe JOIN cohort c ON c.lead_id = pe.lead_id GROUP BY pe.lead_id
  )
  SELECT count(*),
    count(*) FILTER (WHERE lr.max_rank >= 0), count(*) FILTER (WHERE lr.max_rank >= 1),
    count(*) FILTER (WHERE lr.max_rank >= 2), count(*) FILTER (WHERE lr.max_rank >= 3),
    count(*) FILTER (WHERE lr.ever_lost)
  INTO v_cohort_size, v_reached_open, v_reached_book, v_reached_held, v_reached_won, v_lost_count
  FROM lead_reach lr;
  v_cohort_size := COALESCE(v_cohort_size, 0); v_reached_open := COALESCE(v_reached_open, 0);
  v_reached_book := COALESCE(v_reached_book, 0); v_reached_held := COALESCE(v_reached_held, 0);
  v_reached_won := COALESCE(v_reached_won, 0); v_lost_count := COALESCE(v_lost_count, 0);
  v_pre_cutover := lower(v_bounds) < '2026-12-01T00:00:00Z'::timestamptz;
  RETURN jsonb_build_object(
    'period', jsonb_build_object('name', p_period, 'start', lower(v_bounds), 'end', upper(v_bounds)),
    'pipeline_id', p_pipeline_id, 'cohort_size', v_cohort_size, 'lost_count', v_lost_count,
    'pre_cutover_caveat', v_pre_cutover,
    'steps', jsonb_build_array(
      public.fn_funnel_flow_step('open', v_reached_open, v_cohort_size, NULL),
      public.fn_funnel_flow_step('meeting_booked', v_reached_book, v_cohort_size, v_reached_open),
      public.fn_funnel_flow_step('meeting_held', v_reached_held, v_cohort_size, v_reached_book),
      public.fn_funnel_flow_step('won', v_reached_won, v_cohort_size, v_reached_held)
    ),
    'lost', jsonb_build_object('role', 'lost', 'lost_count', v_lost_count,
      'conversion_from_top', CASE WHEN v_cohort_size > 0 THEN round(v_lost_count::numeric / v_cohort_size * 100, 1) ELSE NULL END)
  );
END;
$$;

COMMENT ON FUNCTION public.get_ranking(uuid, text, date, date, date, uuid) IS 'ADR-0017 §2-5,§8 / #997 — leaderboard canônico de venda. RESSALVA custom-pipeline (FIX-6): shape custom-agnóstico, mas custom_pipeline_stages sem governança de stage_role → venda custom não emite sale_event e não aparece até essa governança chegar. Extensão: metric_stage_role.';
