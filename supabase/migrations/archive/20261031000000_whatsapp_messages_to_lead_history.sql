-- =============================================================================
-- Trigger: whatsapp_messages → lead_history
-- Issue: #308 (PRD #284 — Modal Lead v2, F5.2 unified audit trail)
-- Date: 2026-10-31 (filename) / authored 2026-05-19
-- =============================================================================
--
-- AFTER INSERT em whatsapp_messages registra entry em lead_history pra
-- alimentar o feed unificado do modal de lead. Cobre UI, edge functions,
-- n8n, cron — fonte única.
--
-- Lead resolution: prefere `NEW.lead_id` quando o webhook já vinculou.
-- Fallback: lookup por normalized_phone na mesma org + deleted_at NULL.
--
-- Idempotência: skip se já existe row em lead_history com
-- metadata->>'message_id' = NEW.message_id pro mesmo lead.
--
-- direction whatsapp_messages: 'incoming' | 'outgoing'.
-- Normaliza pra action: 'whatsapp_received' | 'whatsapp_sent'.

CREATE OR REPLACE FUNCTION public.fn_whatsapp_message_to_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_id uuid;
  v_action text;
  v_description text;
  v_preview text;
  v_normalized text;
BEGIN
  -- 1. Resolve lead
  IF NEW.lead_id IS NOT NULL THEN
    v_lead_id := NEW.lead_id;
  ELSE
    v_normalized := public.normalize_brazilian_phone(NEW.phone_number);
    SELECT id INTO v_lead_id
    FROM public.leads
    WHERE organization_id = NEW.organization_id
      AND normalized_phone = v_normalized
      AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  IF v_lead_id IS NULL THEN
    RETURN NEW; -- nada a logar
  END IF;

  -- 2. Idempotência — não duplica
  IF EXISTS (
    SELECT 1 FROM public.lead_history
    WHERE lead_id = v_lead_id
      AND metadata->>'message_id' = NEW.message_id
      AND metadata->>'channel' = 'whatsapp'
  ) THEN
    RETURN NEW;
  END IF;

  -- 3. Normalize action
  v_action := CASE NEW.direction
    WHEN 'incoming' THEN 'whatsapp_received'
    WHEN 'outgoing' THEN 'whatsapp_sent'
    ELSE 'whatsapp_event'
  END;

  v_preview := COALESCE(substring(NEW.content from 1 for 80), '');
  v_description := CASE NEW.direction
    WHEN 'incoming' THEN 'WhatsApp recebido'
    WHEN 'outgoing' THEN 'WhatsApp enviado'
    ELSE 'Evento WhatsApp'
  END
  || CASE WHEN length(v_preview) > 0 THEN ': ' || v_preview ELSE '' END;

  -- 4. Insert
  INSERT INTO public.lead_history (
    lead_id, organization_id, action, description, source, metadata, created_at
  )
  VALUES (
    v_lead_id,
    NEW.organization_id,
    v_action,
    v_description,
    'system',
    jsonb_build_object(
      'channel', 'whatsapp',
      'message_id', NEW.message_id,
      'direction', NEW.direction,
      'phone_number', NEW.phone_number,
      'instance_id', NEW.instance_id,
      'remote_jid', NEW.remote_jid,
      'message_type', NEW.message_type
    ),
    COALESCE(NEW.timestamp, NEW.created_at, now())
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_whatsapp_message_to_history ON public.whatsapp_messages;
CREATE TRIGGER trg_whatsapp_message_to_history
  AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_whatsapp_message_to_history();

COMMENT ON FUNCTION public.fn_whatsapp_message_to_history() IS
  'PRD #284 F5.2 — espelha cada whatsapp_messages row pra lead_history. Lead via NEW.lead_id ou normalized_phone fallback. Idempotente via message_id em metadata.';
