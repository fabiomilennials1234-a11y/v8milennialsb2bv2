-- =====================================================
-- resolve_wait_response_by_phone — phone-based variant
-- =====================================================
--
-- Existing RPC `resolve_wait_response(p_lead_id, p_organization_id, p_channel)`
-- (added in 20260901100000_fix_wait_response_node.sql) has ZERO callers in
-- the codebase. Result: workflow executions in status='waiting_response'
-- only exit via timeout — lead replies never advance the workflow.
--
-- This migration adds a phone-based variant that allows the WhatsApp webhook
-- to resolve waiting workflows without first resolving lead_id (cheaper +
-- avoids coupling webhook to lead-lookup logic).
--
-- The phone-based variant looks up matching leads by normalized phone, then
-- delegates to the existing per-lead logic.
-- =====================================================

CREATE OR REPLACE FUNCTION public.resolve_wait_response_by_phone(
  p_phone TEXT,
  p_organization_id UUID,
  p_channel TEXT DEFAULT 'whatsapp'
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total INT := 0;
  v_lead RECORD;
  v_norm TEXT;
BEGIN
  IF p_phone IS NULL OR length(p_phone) < 8 OR p_organization_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Normalize phone: keep digits only. WhatsApp JIDs come as "5511999...@s.whatsapp.net".
  v_norm := regexp_replace(p_phone, '[^0-9]', '', 'g');
  IF length(v_norm) < 8 THEN
    RETURN 0;
  END IF;

  -- Resolve all leads matching by normalized phone within the org.
  -- Multiple leads can share a phone in noisy data; resolve all to be safe.
  FOR v_lead IN
    SELECT id
    FROM public.leads
    WHERE organization_id = p_organization_id
      AND regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = v_norm
  LOOP
    v_total := v_total + COALESCE(
      public.resolve_wait_response(v_lead.id, p_organization_id, p_channel),
      0
    );
  END LOOP;

  RETURN v_total;
END;
$$;

COMMENT ON FUNCTION public.resolve_wait_response_by_phone(text, uuid, text) IS
  'Phone-keyed variant of resolve_wait_response. Called by WhatsApp webhook '
  'on incoming message to advance workflow executions waiting on a reply.';

REVOKE ALL ON FUNCTION public.resolve_wait_response_by_phone(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_wait_response_by_phone(text, uuid, text) TO service_role;
