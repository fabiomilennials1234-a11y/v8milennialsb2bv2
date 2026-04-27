-- ============================================================================
-- HOTFIX F4 — sync_ai_state_from_preferences regressão
--
-- Bug: migration 20260426100000 usa set_config('session_replication_role')
-- que requer SUPERUSER em Postgres. Resultado: toggle_lead_ai/toggle_phone_ai
-- → UPSERT phone_ai_preferences → trigger sync → falha SET session_replication_role
-- → rollback inteiro → switch NÃO persiste. Detectado em E2E test 2026-04-26.
--
-- Fix: usar custom GUC `app.bypass_ai_state_enforce` (namespace 'app.' não
-- requer superuser). enforce_ai_state_transition lê esse setting e pula
-- validação se 'true'.
--
-- Reentrant safe: sync trigger seta GUC LOCAL (transaction-scoped).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Patch enforce_ai_state_transition: bypass via app.bypass_ai_state_enforce
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_ai_state_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed BOOLEAN;
  v_bypass TEXT;
BEGIN
  -- Bypass via custom GUC (set por sync trigger ou contextos privilegiados)
  v_bypass := current_setting('app.bypass_ai_state_enforce', true);
  IF v_bypass = 'true' THEN
    -- Atualiza timestamp mesmo no bypass (consistência)
    NEW.ai_state_updated_at := now();
    RETURN NEW;
  END IF;

  -- Skip se ai_state não mudou
  IF OLD.ai_state IS NOT DISTINCT FROM NEW.ai_state THEN
    RETURN NEW;
  END IF;

  v_allowed := (OLD.ai_state::TEXT, NEW.ai_state::TEXT) IN (
    ('AI_ACTIVE',        'AI_PAUSED_MANUAL'),
    ('AI_ACTIVE',        'WAITING_HUMAN'),
    ('AI_PAUSED_MANUAL', 'AI_ACTIVE'),
    ('AI_PAUSED_MANUAL', 'HUMAN_ACTIVE'),
    ('WAITING_HUMAN',    'HUMAN_ACTIVE'),
    ('WAITING_HUMAN',    'AI_ACTIVE'),
    ('HUMAN_ACTIVE',     'HANDOFF_BACK'),
    ('HUMAN_ACTIVE',     'AI_PAUSED_MANUAL'),
    ('HANDOFF_BACK',     'AI_ACTIVE')
  );

  IF NOT v_allowed THEN
    RAISE EXCEPTION
      'ai_state transition not allowed: % -> %. Valid transitions defined in enforce_ai_state_transition().',
      OLD.ai_state, NEW.ai_state;
  END IF;

  NEW.ai_state_updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_ai_state_transition IS
  'Valida transições FSM ai_state. Bypass via SET LOCAL app.bypass_ai_state_enforce = ''true'' '
  '(usado por sync_ai_state_from_preferences). Hotfix 2026-04-26.';

-- ----------------------------------------------------------------------------
-- 2. Patch sync_ai_state_from_preferences: usa app.bypass_ai_state_enforce
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_ai_state_from_preferences()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_state public.ai_takeover_state_enum;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.ai_disabled IS NOT DISTINCT FROM NEW.ai_disabled THEN
      RETURN NEW;
    END IF;
  END IF;

  v_target_state := CASE
    WHEN NEW.ai_disabled THEN 'AI_PAUSED_MANUAL'::public.ai_takeover_state_enum
    ELSE 'AI_ACTIVE'::public.ai_takeover_state_enum
  END;

  -- Bypass enforce_ai_state_transition via custom GUC (não requer superuser).
  PERFORM set_config('app.bypass_ai_state_enforce', 'true', true);

  UPDATE public.conversations c
  SET ai_state = v_target_state,
      ai_state_updated_at = now(),
      ai_state_updated_by = NEW.set_by
  FROM public.leads l
  WHERE c.lead_id = l.id
    AND l.organization_id = NEW.organization_id
    AND l.normalized_phone = NEW.normalized_phone
    AND CASE
      WHEN NEW.ai_disabled THEN c.ai_state IN ('AI_ACTIVE', 'HANDOFF_BACK', 'WAITING_HUMAN')
      ELSE c.ai_state IN ('AI_PAUSED_MANUAL')
    END;

  -- Limpa GUC pra não vazar pro resto da transação
  PERFORM set_config('app.bypass_ai_state_enforce', 'false', true);

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_ai_state_from_preferences IS
  'F4 + hotfix 2026-04-26: bypass enforce_ai_state_transition via custom GUC '
  'app.bypass_ai_state_enforce (não requer superuser, ao contrário de '
  'session_replication_role que falhava em produção).';
