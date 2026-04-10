-- ============================================================
-- Migration: Refactor enforce_seat_limit to use org_resolve_quota
-- Feature: org-quota-enforcement
-- Traces: REQ-Q09
-- Depends on: 20260910000002_quota_resolution_rpcs
--
-- Unifies seat enforcement through the same quota resolution
-- path used by WhatsApp and Copilot triggers.
-- Also updates org_get_seat_usage to read from org_quotas.
-- ============================================================

-- =========================
-- 1. Refactored enforce_seat_limit
-- =========================

CREATE OR REPLACE FUNCTION public.enforce_seat_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quota JSONB;
BEGIN
  -- Masters nunca são bloqueados pelo limite de seats
  IF public.is_master_user(NEW.user_id) THEN
    RETURN NEW;
  END IF;

  -- Só checa quando ativando um membro (is_active false → true) ou criando ativo
  IF NEW.is_active = true AND (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.is_active = false)) THEN
    -- Lock na org para serializar ativações concorrentes
    PERFORM 1 FROM public.organizations WHERE id = NEW.organization_id FOR UPDATE;

    -- Unified quota resolution
    v_quota := public.org_resolve_quota(NEW.organization_id, 'max_users');

    IF NOT (v_quota->>'is_unlimited')::BOOLEAN
       AND NOT (v_quota->>'can_add')::BOOLEAN
    THEN
      RAISE EXCEPTION 'Limite de seats atingido. Seats pagos: %, membros ativos: %.',
        (v_quota->>'effective_limit')::INTEGER,
        (v_quota->>'current_usage')::INTEGER
      USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- =========================
-- 2. Updated org_get_seat_usage
-- =========================
-- Preserves return shape for existing callers but reads from org_quotas when available.

CREATE OR REPLACE FUNCTION public.org_get_seat_usage(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_quota    JSONB;
  v_plan_name TEXT;
BEGIN
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
$$;
