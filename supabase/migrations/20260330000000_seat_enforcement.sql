-- ================================================================
-- Migration: Seat Enforcement
-- RPC para seat usage + trigger para impedir ativação além dos seats pagos.
-- Date: 2026-03-30
-- ================================================================

-- ============================================
-- 1. RPC: org_get_seat_usage
-- Retorna seats pagos vs. membros ativos para uma org.
-- ============================================

CREATE OR REPLACE FUNCTION public.org_get_seat_usage(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_paid_seats   INTEGER;
  v_active_count INTEGER;
  v_plan_limit   INTEGER;
  v_plan_name    TEXT;
BEGIN
  -- Seats pagos via org_subscriptions
  SELECT os.user_count, sp.name
  INTO v_paid_seats, v_plan_name
  FROM public.org_subscriptions os
  JOIN public.subscription_plans sp ON sp.id = os.plan_id
  WHERE os.organization_id = p_org_id
    AND os.cancelled_at IS NULL;

  -- Se não tem subscription, tenta pegar do plano da org (legacy)
  IF v_paid_seats IS NULL THEN
    SELECT
      COALESCE(
        (o.limit_overrides->>'max_users')::INTEGER,
        (sp.limits->>'max_users')::INTEGER,
        2 -- fallback
      ),
      COALESCE(sp.name, o.subscription_plan, 'free')
    INTO v_plan_limit, v_plan_name
    FROM public.organizations o
    LEFT JOIN public.subscription_plans sp ON sp.name = o.subscription_plan
    WHERE o.id = p_org_id;

    v_paid_seats := v_plan_limit;
  END IF;

  -- Membros ativos na org
  SELECT COUNT(*)::INTEGER
  INTO v_active_count
  FROM public.team_members
  WHERE organization_id = p_org_id
    AND is_active = true;

  RETURN jsonb_build_object(
    'paid_seats',    COALESCE(v_paid_seats, 0),
    'active_members', v_active_count,
    'plan_name',     COALESCE(v_plan_name, 'unknown'),
    'is_unlimited',  COALESCE(v_paid_seats, 0) = -1,
    'can_add',       COALESCE(v_paid_seats, 0) = -1 OR v_active_count < COALESCE(v_paid_seats, 0),
    'remaining',     CASE
                       WHEN COALESCE(v_paid_seats, 0) = -1 THEN -1
                       ELSE GREATEST(COALESCE(v_paid_seats, 0) - v_active_count, 0)
                     END
  );
END;
$$;

COMMENT ON FUNCTION public.org_get_seat_usage IS
  'Retorna uso de seats: paid_seats, active_members, can_add, remaining. '
  '-1 em paid_seats/remaining = ilimitado.';

GRANT EXECUTE ON FUNCTION public.org_get_seat_usage(UUID)
  TO authenticated, service_role;

-- ============================================
-- 2. Trigger: impedir ativação de team_member quando seats esgotados
-- ============================================

CREATE OR REPLACE FUNCTION public.enforce_seat_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usage JSONB;
BEGIN
  -- Só checa quando ativando um membro (is_active false → true) ou criando ativo
  IF NEW.is_active = true AND (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.is_active = false)) THEN
    v_usage := public.org_get_seat_usage(NEW.organization_id);

    -- Se não é ilimitado E já está no limite (sem contar o novo)
    IF NOT (v_usage->>'is_unlimited')::BOOLEAN
       AND (v_usage->>'active_members')::INTEGER >= (v_usage->>'paid_seats')::INTEGER
    THEN
      RAISE EXCEPTION 'Limite de seats atingido. Seats pagos: %, membros ativos: %.',
        (v_usage->>'paid_seats')::INTEGER,
        (v_usage->>'active_members')::INTEGER
      USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Aplicar trigger em team_members
DROP TRIGGER IF EXISTS trg_enforce_seat_limit ON public.team_members;
CREATE TRIGGER trg_enforce_seat_limit
  BEFORE INSERT OR UPDATE OF is_active
  ON public.team_members
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_seat_limit();

COMMENT ON FUNCTION public.enforce_seat_limit IS
  'Trigger que impede ativação de membros além dos seats pagos na org.';
