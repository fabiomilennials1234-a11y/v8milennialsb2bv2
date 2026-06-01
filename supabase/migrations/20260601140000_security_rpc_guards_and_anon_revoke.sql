-- 20260601140000_security_rpc_guards_and_anon_revoke.sql
--
-- Incident 2026-06-01 (part 2). Applied to PROD live via `supabase db query --linked`;
-- this is the durable record (also apply to DEV). Idempotent where possible.
--
-- (1) Add public.assert_org_access(p_org_id) membership guard to 8 SECURITY DEFINER
--     RPCs that lacked it (the other 11 of the 19 cross-org readers already had it).
--     assert_org_access: passes service_role + master + active member of p_org_id;
--     RAISEs 'access_denied' otherwise. Closes authenticated cross-org. anon was
--     additionally blocked at EXECUTE level in 20260601130000.
-- (2) Revoke anon INSERT/UPDATE/DELETE/TRUNCATE on ALL public tables (anon held a
--     blanket write grant on 213 tables; no legitimate flow writes as anon — public
--     submission goes through service_role edge functions). + block future re-grants.
-- (3) Revoke PUBLIC/anon EXECUTE on every SECURITY DEFINER function taking an org-id
--     param (cross-org-by-param class); keep authenticated + service_role.
-- (4) Revoke authenticated on the 4 cron-only SQL leads functions (service_role only).

-- ── (1) membership guards on the 8 unguarded DEFINER readers ──────────────────
BEGIN;


CREATE OR REPLACE FUNCTION public.get_portfolio_clients(p_org_id uuid, p_filter text DEFAULT 'all'::text, p_search text DEFAULT ''::text, p_sort_by text DEFAULT 'name'::text, p_sort_dir text DEFAULT 'asc'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_offset       INT := (p_page - 1) * p_page_size;
  v_total        INT;
  v_rows         JSONB;
  v_allowed_sorts TEXT[] := ARRAY[
    'name', 'health_score', 'avg_ticket', 'days_since_last_order',
    'next_order_expected', 'lifetime_value', 'order_count', 'churn_probability'
  ];
  v_sort         TEXT;
  v_dir          TEXT;
  v_where        TEXT;
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  PERFORM assert_org_member(p_org_id);

  IF p_sort_by = ANY(v_allowed_sorts) THEN
    v_sort := p_sort_by;
  ELSE
    v_sort := 'name';
  END IF;

  IF lower(p_sort_dir) = 'desc' THEN
    v_dir := 'DESC';
  ELSE
    v_dir := 'ASC';
  END IF;

  v_where := format('organization_id = %L AND is_active = true', p_org_id);

  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_where := v_where || format(
      ' AND (name ILIKE %L OR company ILIKE %L)',
      '%' || p_search || '%',
      '%' || p_search || '%'
    );
  END IF;

  IF p_filter = 'overdue' THEN
    v_where := v_where
      || ' AND days_since_last_order IS NOT NULL'
      || ' AND reorder_cycle_days IS NOT NULL'
      || ' AND days_since_last_order > reorder_cycle_days * 1.15';
  ELSIF p_filter = 'expected' THEN
    v_where := v_where
      || ' AND next_order_expected IS NOT NULL'
      || ' AND next_order_expected >= NOW()'
      || ' AND next_order_expected <= NOW() + INTERVAL ''7 days''';
  ELSIF p_filter IN ('ouro', 'prata', 'novo', 'resgate', 'dormindo') THEN
    v_where := v_where || format(' AND segment = %L', p_filter);
  END IF;

  EXECUTE format('SELECT COUNT(*)::int FROM upsell_clients WHERE %s', v_where)
    INTO v_total;

  EXECUTE format(
    $q$
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    FROM (
      SELECT id, name, company, phone, health_score, health_status, segment,
             avg_ticket, days_since_last_order, reorder_cycle_days,
             next_order_expected, order_count, lifetime_value, lead_id, trend,
             churn_probability
      FROM upsell_clients
      WHERE %s
      ORDER BY %I %s NULLS LAST
      LIMIT %s OFFSET %s
    ) t
    $q$,
    v_where, v_sort, v_dir, p_page_size, v_offset
  ) INTO v_rows;

  RETURN jsonb_build_object(
    'rows',        COALESCE(v_rows, '[]'::jsonb),
    'total',       v_total,
    'page',        p_page,
    'page_size',   p_page_size,
    'total_pages', GREATEST(CEIL(v_total::numeric / p_page_size)::int, 1)
  );
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM = 'access_denied' THEN
      RETURN jsonb_build_object(
        'rows', '[]'::jsonb, 'total', 0,
        'page', p_page, 'page_size', p_page_size, 'total_pages', 1
      );
    END IF;
    RAISE;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_portfolio_kpis(p_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  PERFORM assert_org_member(p_org_id);

  RETURN (
    SELECT jsonb_build_object(
      'total_clients',      COUNT(*)::int,
      'total_recurring',    COALESCE(SUM(
                              avg_ticket * (30.0 / GREATEST(COALESCE(reorder_cycle_days, 30), 1))
                            ), 0)::numeric,
      'overdue_count',      COUNT(*) FILTER (
                              WHERE days_since_last_order IS NOT NULL
                                AND reorder_cycle_days IS NOT NULL
                                AND days_since_last_order > reorder_cycle_days * 1.15
                            )::int,
      'overdue_revenue',    COALESCE(SUM(avg_ticket) FILTER (
                              WHERE days_since_last_order IS NOT NULL
                                AND reorder_cycle_days IS NOT NULL
                                AND days_since_last_order > reorder_cycle_days * 1.15
                            ), 0)::numeric,
      'avg_health',         COALESCE(ROUND(AVG(health_score)), 0)::int,
      'avg_ticket',         CASE WHEN COUNT(*) > 0
                              THEN ROUND(COALESCE(SUM(avg_ticket), 0) / COUNT(*))::numeric
                              ELSE 0
                            END,
      'expected_this_week', COUNT(*) FILTER (
                              WHERE next_order_expected IS NOT NULL
                                AND next_order_expected >= NOW()
                                AND next_order_expected <= NOW() + INTERVAL '7 days'
                            )::int,
      'segment_counts',     jsonb_build_object(
                              'ouro',     COUNT(*) FILTER (WHERE segment = 'ouro')::int,
                              'prata',    COUNT(*) FILTER (WHERE segment = 'prata')::int,
                              'novo',     COUNT(*) FILTER (WHERE segment = 'novo')::int,
                              'resgate',  COUNT(*) FILTER (WHERE segment = 'resgate')::int,
                              'dormindo', COUNT(*) FILTER (WHERE segment = 'dormindo')::int
                            )
    )
    FROM upsell_clients
    WHERE organization_id = p_org_id
      AND is_active = true
  );
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM = 'access_denied' THEN RETURN NULL; END IF;
    RAISE;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_revenue_at_risk(p_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  PERFORM assert_org_member(p_org_id);

  RETURN (
    WITH risk_windows AS (
      SELECT
        c.id,
        c.name,
        c.segment,
        c.avg_ticket,
        c.next_order_expected,
        c.health_score,
        c.churn_probability,
        CASE
          WHEN c.next_order_expected::date <= CURRENT_DATE + 7 THEN '7d'
          WHEN c.next_order_expected::date <= CURRENT_DATE + 14 THEN '14d'
          WHEN c.next_order_expected::date <= CURRENT_DATE + 30 THEN '30d'
          ELSE NULL
        END AS risk_window
      FROM upsell_clients c
      WHERE c.organization_id = p_org_id
        AND c.is_active = true
        AND c.next_order_expected IS NOT NULL
        AND c.next_order_expected::date <= CURRENT_DATE + 30
        AND c.avg_ticket IS NOT NULL
    )
    SELECT jsonb_build_object(
      'windows', jsonb_build_object(
        '7d', jsonb_build_object(
          'total', COALESCE(SUM(avg_ticket) FILTER (WHERE risk_window = '7d' OR next_order_expected::date <= CURRENT_DATE + 7), 0),
          'count', COUNT(*) FILTER (WHERE risk_window = '7d' OR next_order_expected::date <= CURRENT_DATE + 7),
          'ouro_total', COALESCE(SUM(avg_ticket) FILTER (WHERE (risk_window = '7d' OR next_order_expected::date <= CURRENT_DATE + 7) AND segment = 'ouro'), 0)
        ),
        '14d', jsonb_build_object(
          'total', COALESCE(SUM(avg_ticket) FILTER (WHERE next_order_expected::date <= CURRENT_DATE + 14), 0),
          'count', COUNT(*) FILTER (WHERE next_order_expected::date <= CURRENT_DATE + 14),
          'ouro_total', COALESCE(SUM(avg_ticket) FILTER (WHERE next_order_expected::date <= CURRENT_DATE + 14 AND segment = 'ouro'), 0)
        ),
        '30d', jsonb_build_object(
          'total', COALESCE(SUM(avg_ticket), 0),
          'count', COUNT(*),
          'ouro_total', COALESCE(SUM(avg_ticket) FILTER (WHERE segment = 'ouro'), 0)
        )
      ),
      'top_risk_clients', (
        SELECT jsonb_agg(jsonb_build_object(
          'id', sub.id,
          'name', sub.name,
          'segment', sub.segment,
          'avg_ticket', sub.avg_ticket,
          'next_order_expected', sub.next_order_expected,
          'churn_probability', sub.churn_probability
        ) ORDER BY sub.avg_ticket DESC)
        FROM (
          SELECT * FROM risk_windows
          WHERE segment = 'ouro'
          ORDER BY avg_ticket DESC
          LIMIT 5
        ) sub
      )
    )
    FROM risk_windows
  );
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM = 'access_denied' THEN RETURN NULL; END IF;
    RAISE;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_vendedor_ranking(p_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  PERFORM assert_org_member(p_org_id);

  RETURN (
    SELECT COALESCE(jsonb_agg(row_data ORDER BY sort_health DESC), '[]'::jsonb)
    FROM (
      SELECT
        ROUND(AVG(c.health_score)) AS sort_health,
        jsonb_build_object(
          'closer_id', tm.id,
          'name', tm.name,
          'role', tm.role,
          'total_clients', COUNT(c.id),
          'avg_health', ROUND(AVG(c.health_score)),
          'avg_churn', ROUND(AVG(c.churn_probability)),
          'avg_ticket', ROUND(AVG(c.avg_ticket)::numeric, 2),
          'total_revenue', SUM(c.lifetime_value),
          'on_time_pct', ROUND(
            COUNT(*) FILTER (
              WHERE c.days_since_last_order <= c.reorder_cycle_days
            )::numeric / NULLIF(COUNT(*) FILTER (WHERE c.reorder_cycle_days > 0), 0) * 100
          ),
          'segments', jsonb_build_object(
            'ouro', COUNT(*) FILTER (WHERE c.segment = 'ouro'),
            'prata', COUNT(*) FILTER (WHERE c.segment = 'prata'),
            'novo', COUNT(*) FILTER (WHERE c.segment = 'novo'),
            'resgate', COUNT(*) FILTER (WHERE c.segment = 'resgate'),
            'dormindo', COUNT(*) FILTER (WHERE c.segment = 'dormindo')
          )
        ) AS row_data
      FROM team_members tm
      JOIN upsell_clients c ON c.id = tm.id AND c.is_active = true
      WHERE c.organization_id = p_org_id
        AND tm.is_active = true
      GROUP BY tm.id, tm.name, tm.role
      HAVING COUNT(c.id) > 0
    ) sub
  );
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM = 'access_denied' THEN RETURN '[]'::jsonb; END IF;
    RAISE;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.org_get_seat_usage(p_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_quota    JSONB;
  v_plan_name TEXT;
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  -- Use unified quota resolution
  v_quota := public.org_resolve_quota(p_org_id, 'max_users');

  -- Get plan name for backward compat
  SELECT COALESCE(sp.name, o.subscription_plan, 'free')
  INTO v_plan_name
  FROM public.organizations o
  LEFT JOIN public.org_subscriptions os ON os.organization_id = o.id AND os.cancelled_at IS NULL
  LEFT JOIN public.subscription_plans sp ON sp.id = os.plan_id
  WHERE o.id = p_org_id;

  -- Return same shape as before
  RETURN jsonb_build_object(
    'paid_seats',     (v_quota->>'effective_limit')::INTEGER,
    'active_members', (v_quota->>'current_usage')::INTEGER,
    'plan_name',      COALESCE(v_plan_name, 'unknown'),
    'is_unlimited',   (v_quota->>'is_unlimited')::BOOLEAN,
    'can_add',        (v_quota->>'can_add')::BOOLEAN,
    'remaining',      (v_quota->>'remaining')::INTEGER
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.org_get_subscription_status(p_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org RECORD;
  v_overdue_since TIMESTAMPTZ;
  v_grace_remaining INTEGER;
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  SELECT
    subscription_status,
    subscription_plan,
    subscription_expires_at,
    billing_override
  INTO v_org
  FROM public.organizations
  WHERE id = p_org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'expired',
      'is_valid', false,
      'days_remaining', 0,
      'grace_remaining', 0
    );
  END IF;

  -- Se overdue, calcular dias de graça restantes
  IF v_org.subscription_status = 'overdue' THEN
    SELECT MIN(created_at)
    INTO v_overdue_since
    FROM public.payment_history
    WHERE organization_id = p_org_id
      AND status = 'overdue';

    IF v_overdue_since IS NOT NULL THEN
      v_grace_remaining := GREATEST(7 - EXTRACT(DAY FROM NOW() - v_overdue_since)::INTEGER, 0);
    ELSE
      v_grace_remaining := 7;
    END IF;
  ELSE
    v_grace_remaining := NULL;
  END IF;

  RETURN jsonb_build_object(
    'status',            v_org.subscription_status,
    'plan',              v_org.subscription_plan,
    'expires_at',        v_org.subscription_expires_at,
    'billing_override',  COALESCE(v_org.billing_override, false),
    'is_valid',          v_org.subscription_status IN ('active', 'trial', 'overdue')
                           OR COALESCE(v_org.billing_override, false),
    'days_remaining',    CASE
                           WHEN v_org.subscription_expires_at IS NOT NULL
                             THEN GREATEST(EXTRACT(DAY FROM v_org.subscription_expires_at - NOW())::INTEGER, 0)
                           ELSE NULL
                         END,
    'grace_remaining',   v_grace_remaining,
    'is_overdue',        v_org.subscription_status = 'overdue',
    'is_blocked',        v_org.subscription_status IN ('suspended', 'cancelled', 'expired')
                           AND NOT COALESCE(v_org.billing_override, false)
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.org_resolve_all_quotas(p_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  RETURN jsonb_build_object(
    'max_whatsapp_instances', public.org_resolve_quota(p_org_id, 'max_whatsapp_instances'),
    'max_users',              public.org_resolve_quota(p_org_id, 'max_users'),
    'max_copilot_agents',     public.org_resolve_quota(p_org_id, 'max_copilot_agents')
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.org_resolve_quota(p_org_id uuid, p_resource_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_plan_base        INTEGER := 0;
  v_purchased_addons INTEGER := 0;
  v_admin_adjustment INTEGER := 0;
  v_effective_limit  INTEGER := 0;
  v_current_usage    INTEGER := 0;
  v_is_unlimited     BOOLEAN := FALSE;
  v_can_add          BOOLEAN := FALSE;
  v_remaining        INTEGER := 0;
  v_quota            RECORD;
  v_plan_limit       INTEGER;
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  -- -----------------------------------------------
  -- Step 1: Master user → everything unlimited
  -- -----------------------------------------------
  IF public.is_master_user() THEN
    -- Still count actual usage for informational purposes
    CASE p_resource_key
      WHEN 'max_whatsapp_instances' THEN
        SELECT COUNT(*)::INTEGER INTO v_current_usage
        FROM public.whatsapp_instances
        WHERE organization_id = p_org_id;
      WHEN 'max_users' THEN
        SELECT COUNT(*)::INTEGER INTO v_current_usage
        FROM public.team_members
        WHERE organization_id = p_org_id
          AND is_active = true
          AND NOT public.is_master_user(user_id);
      WHEN 'max_copilot_agents' THEN
        SELECT COUNT(*)::INTEGER INTO v_current_usage
        FROM public.copilot_agents
        WHERE organization_id = p_org_id;
      ELSE
        v_current_usage := 0;
    END CASE;

    RETURN jsonb_build_object(
      'plan_base',        -1,
      'purchased_addons', 0,
      'admin_adjustment', 0,
      'effective_limit',  -1,
      'current_usage',    v_current_usage,
      'is_unlimited',     TRUE,
      'can_add',          TRUE,
      'remaining',        -1
    );
  END IF;

  -- -----------------------------------------------
  -- Step 2: Read from org_quotas (authoritative)
  -- -----------------------------------------------
  SELECT oq.plan_base,
         oq.purchased_addons,
         oq.admin_adjustment,
         oq.effective_limit
  INTO v_quota
  FROM public.org_quotas oq
  WHERE oq.organization_id = p_org_id
    AND oq.resource_key = p_resource_key;

  IF FOUND THEN
    v_plan_base        := v_quota.plan_base;
    v_purchased_addons := v_quota.purchased_addons;
    v_admin_adjustment := v_quota.admin_adjustment;
    v_effective_limit  := v_quota.effective_limit;
  ELSE
    -- -----------------------------------------------
    -- Step 3: Fallback chain to plan limits
    -- -----------------------------------------------

    -- 3a. org_subscriptions → subscription_plans.limits
    SELECT (sp.limits ->> p_resource_key)::INTEGER
    INTO v_plan_limit
    FROM public.org_subscriptions os
    JOIN public.subscription_plans sp ON sp.id = os.plan_id
    WHERE os.organization_id = p_org_id
      AND os.cancelled_at IS NULL;

    IF v_plan_limit IS NOT NULL THEN
      v_plan_base       := v_plan_limit;
      v_effective_limit := v_plan_limit;
    ELSE
      -- 3b. organizations.subscription_plan → subscription_plans.limits
      SELECT (sp.limits ->> p_resource_key)::INTEGER
      INTO v_plan_limit
      FROM public.organizations o
      JOIN public.subscription_plans sp ON sp.name = o.subscription_plan
      WHERE o.id = p_org_id;

      IF v_plan_limit IS NOT NULL THEN
        v_plan_base       := v_plan_limit;
        v_effective_limit := v_plan_limit;
      ELSE
        -- 3c. organizations.limit_overrides
        SELECT (o.limit_overrides ->> p_resource_key)::INTEGER
        INTO v_plan_limit
        FROM public.organizations o
        WHERE o.id = p_org_id
          AND o.limit_overrides IS NOT NULL
          AND o.limit_overrides ? p_resource_key;

        IF v_plan_limit IS NOT NULL THEN
          v_plan_base       := v_plan_limit;
          v_effective_limit := v_plan_limit;
        ELSE
          -- 3d. Default: 0
          v_plan_base       := 0;
          v_effective_limit := 0;
        END IF;
      END IF;
    END IF;

    -- No addons or adjustments in fallback path
    v_purchased_addons := 0;
    v_admin_adjustment := 0;
  END IF;

  -- -----------------------------------------------
  -- Step 4: Count current usage
  -- -----------------------------------------------
  CASE p_resource_key
    WHEN 'max_whatsapp_instances' THEN
      SELECT COUNT(*)::INTEGER INTO v_current_usage
      FROM public.whatsapp_instances
      WHERE organization_id = p_org_id;
    WHEN 'max_users' THEN
      SELECT COUNT(*)::INTEGER INTO v_current_usage
      FROM public.team_members
      WHERE organization_id = p_org_id
        AND is_active = true
        AND NOT public.is_master_user(user_id);
    WHEN 'max_copilot_agents' THEN
      SELECT COUNT(*)::INTEGER INTO v_current_usage
      FROM public.copilot_agents
      WHERE organization_id = p_org_id;
    ELSE
      v_current_usage := 0;
  END CASE;

  -- -----------------------------------------------
  -- Step 5: Compute derived fields
  -- -----------------------------------------------
  v_is_unlimited := (v_effective_limit = -1);
  v_can_add      := v_is_unlimited OR (v_current_usage < v_effective_limit);
  v_remaining    := CASE
                      WHEN v_is_unlimited THEN -1
                      ELSE GREATEST(v_effective_limit - v_current_usage, 0)
                    END;

  RETURN jsonb_build_object(
    'plan_base',        v_plan_base,
    'purchased_addons', v_purchased_addons,
    'admin_adjustment', v_admin_adjustment,
    'effective_limit',  v_effective_limit,
    'current_usage',    v_current_usage,
    'is_unlimited',     v_is_unlimited,
    'can_add',          v_can_add,
    'remaining',        v_remaining
  );
END;
$function$
;
COMMIT;

-- ── (2) revoke anon table writes globally + block future grants ───────────────
BEGIN;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon;
COMMIT;

-- ── (3) revoke PUBLIC/anon EXECUTE on org-param SECURITY DEFINER functions ─────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef
      AND (pg_get_function_arguments(p.oid) ILIKE '%p_org_id%'
        OR pg_get_function_arguments(p.oid) ILIKE '%p_organization_id%'
        OR pg_get_function_arguments(p.oid) ILIKE '%org_id %')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;

-- ── (4) cron-only SQL leads functions: service_role only ──────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname = ANY(ARRAY['get_leads_team_no_response','get_leads_no_response_from_lead','get_leads_not_confirmed','get_followup_eligible_leads'])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;
