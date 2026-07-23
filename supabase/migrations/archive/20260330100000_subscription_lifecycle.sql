-- ================================================================
-- Migration: Subscription Lifecycle Automation
-- Funções para transição automática de status de subscription.
-- Date: 2026-03-30
-- ================================================================

-- ============================================
-- 1. Function: Transicionar orgs overdue → suspended
-- Chamada via cron ou manualmente. Grace period = 7 dias.
-- ============================================

CREATE OR REPLACE FUNCTION public.process_overdue_subscriptions(
  p_grace_days INTEGER DEFAULT 7
)
RETURNS TABLE (
  organization_id UUID,
  org_name TEXT,
  days_overdue INTEGER,
  new_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH overdue_orgs AS (
    SELECT
      o.id,
      o.name,
      COALESCE(
        (SELECT EXTRACT(DAY FROM NOW() - MIN(ph.created_at))::INTEGER
         FROM public.payment_history ph
         WHERE ph.organization_id = o.id
           AND ph.status = 'overdue'
        ),
        0
      ) AS overdue_days
    FROM public.organizations o
    WHERE o.subscription_status = 'overdue'
  )
  UPDATE public.organizations org
  SET
    subscription_status = 'suspended',
    updated_at = NOW()
  FROM overdue_orgs oo
  WHERE org.id = oo.id
    AND oo.overdue_days >= p_grace_days
  RETURNING org.id, oo.name, oo.overdue_days, 'suspended'::TEXT;
END;
$$;

COMMENT ON FUNCTION public.process_overdue_subscriptions IS
  'Transiciona orgs overdue → suspended após grace period (default 7 dias). '
  'Retorna lista de orgs transicionadas.';

GRANT EXECUTE ON FUNCTION public.process_overdue_subscriptions(INTEGER)
  TO service_role;

-- ============================================
-- 2. RPC: org_get_subscription_status (batched, for frontend)
-- Retorna status completo da subscription para o guard no frontend.
-- ============================================

CREATE OR REPLACE FUNCTION public.org_get_subscription_status(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_org RECORD;
  v_overdue_since TIMESTAMPTZ;
  v_grace_remaining INTEGER;
BEGIN
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
$$;

COMMENT ON FUNCTION public.org_get_subscription_status IS
  'Status completo da subscription para o frontend guard. '
  'Inclui grace_remaining para orgs overdue.';

GRANT EXECUTE ON FUNCTION public.org_get_subscription_status(UUID)
  TO authenticated, service_role;
