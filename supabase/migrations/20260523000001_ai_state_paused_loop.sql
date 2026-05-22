-- Add AI_PAUSED_LOOP state for bot-loop-detector pause action.
--
-- Origem: investigação Bertin 2026-05-08/09. 3000+ msgs em loop bot-to-bot
-- com chatbot externo. Detector marca conversa AI_PAUSED_LOOP até humano
-- investigar — distingue de AI_PAUSED_MANUAL (operador pausou) e
-- WAITING_HUMAN (IA pediu humano).

-- Enum extension. ALTER TYPE ... ADD VALUE runs outside an implicit
-- transaction; the migration framework runs each file in its own tx but
-- ALTER TYPE ADD VALUE IF NOT EXISTS is allowed in tx since PG 12.
ALTER TYPE public.ai_takeover_state_enum ADD VALUE IF NOT EXISTS 'AI_PAUSED_LOOP';

-- Update transition table to allow:
--   AI_ACTIVE        → AI_PAUSED_LOOP  (detector pausa)
--   AI_PAUSED_LOOP   → AI_ACTIVE       (humano retoma após investigar)
--   AI_PAUSED_LOOP   → HUMAN_ACTIVE    (humano assumiu manualmente)
--
-- Trigger function rewritten to include new pairs. Existing pairs preserved
-- exactly to avoid behavior drift.
CREATE OR REPLACE FUNCTION public.enforce_ai_state_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed BOOLEAN := FALSE;
BEGIN
  IF NEW.ai_state = OLD.ai_state THEN
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
    ('HANDOFF_BACK',     'AI_ACTIVE'),
    -- New: loop detector
    ('AI_ACTIVE',        'AI_PAUSED_LOOP'),
    ('AI_PAUSED_LOOP',   'AI_ACTIVE'),
    ('AI_PAUSED_LOOP',   'HUMAN_ACTIVE'),
    ('AI_PAUSED_LOOP',   'AI_PAUSED_MANUAL')
  );

  IF NOT v_allowed THEN
    RAISE EXCEPTION
      'ai_state transition not allowed: % -> %.',
      OLD.ai_state,
      NEW.ai_state
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.ai_state_updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON TYPE public.ai_takeover_state_enum IS
  'Estados de takeover IA↔Humano. AI_PAUSED_LOOP adicionado em 2026-05-23 para bot-loop-detector.';
