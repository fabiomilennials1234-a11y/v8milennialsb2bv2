-- ============================================================================
-- F4 (Onda 3) — sync conversations.ai_state ← phone_ai_preferences.ai_disabled
--
-- Problema resolvido:
--   FSM conversations.ai_state foi introduzida em 2026-04-22 mas ficou ÓRFÃ
--   da fonte de verdade (phone_ai_preferences). Banner takeover pausava
--   ai_state mas não setava ai_disabled — copilot continuava respondendo.
--
-- Fix:
--   - Trigger AFTER UPDATE/INSERT em phone_ai_preferences propaga pro
--     conversations.ai_state das conversas relacionadas (mesmo
--     organization_id + normalized_phone via lead_id).
--   - ai_disabled = true → ai_state = 'AI_PAUSED_MANUAL'
--   - ai_disabled = false → ai_state = 'AI_ACTIVE'
--   - Bypass enforce_ai_state_transition via SET LOCAL session_replication_role
--     (sync programático, não passa por validação de FSM humana).
--   - Backfill inicial: alinha histórico antes de armar trigger.
--
-- Sentido oposto (ai_state → preferences) NÃO é automático aqui — banner
-- takeover continua a permitir HUMAN_ACTIVE/WAITING_HUMAN/HANDOFF_BACK
-- (estados sem efeito direto em ai_disabled). Pause manual via banner em
-- ondas futuras pode chamar toggle_phone_ai pra alinhar.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Backfill: alinha conversations.ai_state com phone_ai_preferences atual
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  v_aligned INTEGER := 0;
BEGIN
  -- Bypass trigger enforce_ai_state_transition durante backfill.
  -- session_replication_role='replica' desabilita triggers de tabela
  -- exceto os marcados ENABLE REPLICA — enforce_ai_state_transition é
  -- ENABLE TRIGGER ALWAYS only se foi marcado, senão skipa em replica mode.
  SET LOCAL session_replication_role = 'replica';

  WITH targets AS (
    SELECT DISTINCT c.id, p.ai_disabled
    FROM public.conversations c
    JOIN public.leads l ON l.id = c.lead_id
    JOIN public.phone_ai_preferences p
      ON p.organization_id = l.organization_id
     AND p.normalized_phone = l.normalized_phone
    WHERE l.normalized_phone IS NOT NULL
      AND (
        (p.ai_disabled = true  AND c.ai_state IN ('AI_ACTIVE', 'HANDOFF_BACK')) OR
        (p.ai_disabled = false AND c.ai_state = 'AI_PAUSED_MANUAL')
      )
  )
  UPDATE public.conversations c
  SET ai_state = CASE WHEN t.ai_disabled THEN 'AI_PAUSED_MANUAL'::public.ai_takeover_state_enum ELSE 'AI_ACTIVE'::public.ai_takeover_state_enum END,
      ai_state_updated_at = now(),
      ai_state_updated_by = NULL
  FROM targets t
  WHERE c.id = t.id;

  GET DIAGNOSTICS v_aligned = ROW_COUNT;
  RAISE NOTICE '[sync_ai_state] Backfill aligned % conversations to phone_ai_preferences', v_aligned;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Trigger: phone_ai_preferences UPDATE/INSERT → conversations.ai_state
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_ai_state_from_preferences()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_state public.ai_takeover_state_enum;
  v_old_disabled BOOLEAN;
BEGIN
  -- INSERT: NEW.ai_disabled é o valor inicial
  -- UPDATE: só dispara se ai_disabled mudou
  IF TG_OP = 'UPDATE' THEN
    v_old_disabled := OLD.ai_disabled;
    IF v_old_disabled IS NOT DISTINCT FROM NEW.ai_disabled THEN
      RETURN NEW;
    END IF;
  END IF;

  v_target_state := CASE
    WHEN NEW.ai_disabled THEN 'AI_PAUSED_MANUAL'::public.ai_takeover_state_enum
    ELSE 'AI_ACTIVE'::public.ai_takeover_state_enum
  END;

  -- Bypass enforce_ai_state_transition (sync programático, não FSM humana).
  PERFORM set_config('session_replication_role', 'replica', true);

  UPDATE public.conversations c
  SET ai_state = v_target_state,
      ai_state_updated_at = now(),
      ai_state_updated_by = NEW.set_by
  FROM public.leads l
  WHERE c.lead_id = l.id
    AND l.organization_id = NEW.organization_id
    AND l.normalized_phone = NEW.normalized_phone
    -- Não regride estados em-flight humanos. Só sincroniza:
    --   - de qualquer estado pra AI_PAUSED_MANUAL quando disabling
    --   - de AI_PAUSED_MANUAL pra AI_ACTIVE quando reactivating
    AND CASE
      WHEN NEW.ai_disabled THEN c.ai_state IN ('AI_ACTIVE', 'HANDOFF_BACK', 'WAITING_HUMAN')
      ELSE c.ai_state IN ('AI_PAUSED_MANUAL')
    END;

  PERFORM set_config('session_replication_role', 'origin', true);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_ai_state_from_preferences ON public.phone_ai_preferences;

CREATE TRIGGER trg_sync_ai_state_from_preferences
  AFTER INSERT OR UPDATE OF ai_disabled ON public.phone_ai_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_ai_state_from_preferences();

COMMENT ON FUNCTION public.sync_ai_state_from_preferences IS
  'F4 2026-04-26: sync conversations.ai_state ← phone_ai_preferences.ai_disabled. '
  'phone_ai_preferences é fonte de verdade; ai_state é derivado. Bypass '
  'enforce_ai_state_transition via session_replication_role=replica.';
