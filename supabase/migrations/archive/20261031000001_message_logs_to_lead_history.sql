-- =============================================================================
-- Triggers: emails / sms_messages → lead_history
-- Issue: #309 (PRD #284 — Modal Lead v2, F5.2 unified audit trail)
-- Date: 2026-10-31 (filename) / authored 2026-05-19
-- =============================================================================
--
-- Pair com #308 (whatsapp_messages trigger). call_logs já tem trigger
-- equivalente desde 20260952 (fn_call_log_to_history). Esta migration
-- cobre os outros 2 canais.
--
-- emails.is_outbound boolean → action = 'email_sent' | 'email_received'.
-- sms_messages.direction text 'outbound'|'inbound' → 'sms_sent' | 'sms_received'.
--
-- Idempotência por metadata->>'message_id' (emails.message_id /
-- sms_messages.provider_message_id).

-- ============================================================================
-- emails
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_email_to_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text;
  v_description text;
  v_preview text;
BEGIN
  IF NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.lead_history
    WHERE lead_id = NEW.lead_id
      AND metadata->>'channel' = 'email'
      AND metadata->>'message_id' = NEW.message_id
  ) THEN
    RETURN NEW;
  END IF;

  v_action := CASE WHEN NEW.is_outbound THEN 'email_sent' ELSE 'email_received' END;
  v_preview := COALESCE(NEW.subject, substring(COALESCE(NEW.snippet, NEW.body_text, '') from 1 for 80), '');
  v_description := CASE WHEN NEW.is_outbound THEN 'Email enviado' ELSE 'Email recebido' END
    || CASE WHEN length(v_preview) > 0 THEN ': ' || v_preview ELSE '' END;

  INSERT INTO public.lead_history (
    lead_id, organization_id, action, description, source, metadata, created_at
  )
  VALUES (
    NEW.lead_id,
    NEW.organization_id,
    v_action,
    v_description,
    'system',
    jsonb_build_object(
      'channel', 'email',
      'message_id', NEW.message_id,
      'direction', CASE WHEN NEW.is_outbound THEN 'sent' ELSE 'received' END,
      'thread_id', NEW.thread_id,
      'from_address', NEW.from_address,
      'subject', NEW.subject,
      'email_account_id', NEW.email_account_id
    ),
    COALESCE(NEW.sent_at, NEW.created_at, now())
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_email_to_history ON public.emails;
CREATE TRIGGER trg_email_to_history
  AFTER INSERT ON public.emails
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_email_to_history();

-- ============================================================================
-- sms_messages
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_sms_to_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text;
  v_description text;
  v_preview text;
BEGIN
  IF NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.provider_message_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.lead_history
    WHERE lead_id = NEW.lead_id
      AND metadata->>'channel' = 'sms'
      AND metadata->>'message_id' = NEW.provider_message_id
  ) THEN
    RETURN NEW;
  END IF;

  v_action := CASE NEW.direction
    WHEN 'outbound' THEN 'sms_sent'
    WHEN 'inbound' THEN 'sms_received'
    ELSE 'sms_event'
  END;

  v_preview := substring(COALESCE(NEW.body, '') from 1 for 80);
  v_description := CASE NEW.direction
    WHEN 'outbound' THEN 'SMS enviado'
    WHEN 'inbound' THEN 'SMS recebido'
    ELSE 'Evento SMS'
  END
    || CASE WHEN length(v_preview) > 0 THEN ': ' || v_preview ELSE '' END;

  INSERT INTO public.lead_history (
    lead_id, organization_id, action, description, source, metadata, created_by, created_at
  )
  VALUES (
    NEW.lead_id,
    NEW.organization_id,
    v_action,
    v_description,
    'system',
    jsonb_build_object(
      'channel', 'sms',
      'message_id', NEW.provider_message_id,
      'direction', NEW.direction,
      'from_number', NEW.from_number,
      'to_number', NEW.to_number,
      'status', NEW.status
    ),
    NEW.sent_by,
    COALESCE(NEW.sent_at, NEW.created_at, now())
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sms_to_history ON public.sms_messages;
CREATE TRIGGER trg_sms_to_history
  AFTER INSERT ON public.sms_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sms_to_history();

COMMENT ON FUNCTION public.fn_email_to_history() IS
  'PRD #284 F5.2 — espelha emails pra lead_history. Idempotente via message_id em metadata.';
COMMENT ON FUNCTION public.fn_sms_to_history() IS
  'PRD #284 F5.2 — espelha sms_messages pra lead_history. Idempotente via provider_message_id em metadata.';
