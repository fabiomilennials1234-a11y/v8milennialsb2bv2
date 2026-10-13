-- Rollback of 20271120000000_copilot_handoff_disabled_reason.sql.
-- Restores transfer_lead_to_human (md5 3b7c391d…) and sync_lead_ai_to_preferences
-- (md5 072d1c5e…) to prod as of 2026-10-13 and drops disabled_reason.
-- ORDER MATTERS: deploy the edge functions WITHOUT disabled_reason first.
-- Dropping the column while cancellation.ts still selects it makes the gate
-- fall back to the legacy select and stop re-enabling (fail-safe), and the
-- re-enable guard `.is("disabled_reason", null)` fails → no pref write.
-- Handoff becomes non-sticky again (H2 returns).
BEGIN;

CREATE OR REPLACE FUNCTION public.transfer_lead_to_human(p_lead_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_lead_id IS NULL THEN
    RAISE EXCEPTION 'p_lead_id cannot be null';
  END IF;

  UPDATE public.leads
  SET ai_disabled = true,
      ai_disabled_at = COALESCE(ai_disabled_at, NOW()),
      updated_at = NOW()
  WHERE id = p_lead_id;

  UPDATE public.conversations
  SET state = 'WAITING_HUMAN',
      updated_at = NOW()
  WHERE lead_id = p_lead_id
    AND state <> 'WAITING_HUMAN';
END;
$function$;

COMMENT ON FUNCTION public.transfer_lead_to_human(uuid) IS 'Onda 1 T1.0.6: transferência atômica de lead para humano. Sincroniza leads.ai_disabled e conversations.state em transação única. Substitui código não-transacional em _shared/ai-action-executor.ts.';

CREATE OR REPLACE FUNCTION public.sync_lead_ai_to_preferences()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  -- Apenas quando a flag realmente muda
  IF NEW.ai_disabled IS DISTINCT FROM OLD.ai_disabled THEN
    -- Exige normalized_phone para ter chave canônica
    IF NEW.normalized_phone IS NOT NULL AND length(NEW.normalized_phone) > 0 THEN
      INSERT INTO public.phone_ai_preferences (
        organization_id, normalized_phone, ai_disabled, set_by, set_at
      ) VALUES (
        NEW.organization_id,
        NEW.normalized_phone,
        NEW.ai_disabled,
        NEW.ai_disabled_by,  -- Pode ser NULL se o caller não preencheu
        COALESCE(NEW.ai_disabled_at, now())
      )
      ON CONFLICT (organization_id, normalized_phone) DO UPDATE
      SET ai_disabled = EXCLUDED.ai_disabled,
          set_by = COALESCE(EXCLUDED.set_by, public.phone_ai_preferences.set_by),
          set_at = EXCLUDED.set_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.sync_lead_ai_to_preferences() IS 'Rede de segurança: sincroniza phone_ai_preferences quando leads.ai_disabled muda por qualquer caminho. Mantém a invariante "fonte única = preferences" mesmo se alguém bypassar as RPCs canônicas.';

ALTER TABLE public.phone_ai_preferences DROP CONSTRAINT IF EXISTS phone_ai_preferences_disabled_reason_check;
ALTER TABLE public.phone_ai_preferences DROP COLUMN IF EXISTS disabled_reason;

COMMIT;
