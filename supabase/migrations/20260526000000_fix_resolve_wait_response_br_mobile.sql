-- =====================================================
-- FIX: resolve_wait_response_by_phone — BR mobile 9-prefix normalization
-- =====================================================
--
-- Incident reference: lead Rodrigo Marques / org Barulinho Bom (2026-05-24/25).
-- Lead saved with phone '+5581988671414' (13 digits, with 9 mobile prefix);
-- WhatsApp JID arrived as '558188671414@s.whatsapp.net' (12 digits, no 9 —
-- old Pernambuco mobile format). The original function used strict
-- digit equality (regexp_replace(phone, '[^0-9]', '', 'g') = v_norm) so
-- the lead was never matched, the workflow's wait_response never resolved,
-- the 24h timeout fired, and the lead was moved to "esfriou" while
-- actively engaged in conversation.
--
-- Fix mirrors the 3-tier cascade already used by
-- resolve_message_lead_id() (migration 20261004000000_auto_link_message_lead.sql):
--   1. Exact match on phone_digits
--   2. normalize_br_mobile() equivalence (handles 9th-digit absence/presence)
--   3. Suffix match on right(phone_digits, 11) for international/legacy numbers
--
-- Also switches the matching column from raw `phone` (manually formatted user
-- input) to `phone_digits` (canonical digits-only column with index
-- idx_leads_org_phone_digits). This preserves index usage on the exact path.
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
  v_normalized_br TEXT;
BEGIN
  IF p_phone IS NULL OR length(p_phone) < 8 OR p_organization_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Normalize incoming phone: digits only. WhatsApp JIDs come as
  -- "5511999...@s.whatsapp.net"; webhook may also pass formatted strings.
  v_norm := regexp_replace(p_phone, '[^0-9]', '', 'g');
  IF length(v_norm) < 8 THEN
    RETURN 0;
  END IF;

  -- 1) Exact match on phone_digits (uses idx_leads_org_phone_digits).
  -- Resolve all matches: noisy data can carry the same phone on multiple leads.
  FOR v_lead IN
    SELECT id
    FROM public.leads
    WHERE organization_id = p_organization_id
      AND phone_digits = v_norm
      AND phone_digits != ''
  LOOP
    v_total := v_total + COALESCE(
      public.resolve_wait_response(v_lead.id, p_organization_id, p_channel),
      0
    );
  END LOOP;

  -- 2) BR mobile normalization match (handles 9th-digit prefix variance).
  -- Skip if length too short to be a BR mobile.
  IF v_total = 0 AND length(v_norm) >= 10 THEN
    v_normalized_br := normalize_br_mobile(v_norm);

    FOR v_lead IN
      SELECT id
      FROM public.leads
      WHERE organization_id = p_organization_id
        AND phone_digits != ''
        AND length(phone_digits) >= 10
        AND normalize_br_mobile(phone_digits) = v_normalized_br
    LOOP
      v_total := v_total + COALESCE(
        public.resolve_wait_response(v_lead.id, p_organization_id, p_channel),
        0
      );
    END LOOP;
  END IF;

  -- 3) Suffix match on last 11 digits (fallback for legacy / DDI variants).
  -- Guard: requires >= 11 digits on both sides to avoid false positives
  -- on short numbers that share a tail.
  IF v_total = 0 AND length(v_norm) >= 11 THEN
    FOR v_lead IN
      SELECT id
      FROM public.leads
      WHERE organization_id = p_organization_id
        AND phone_digits != ''
        AND length(phone_digits) >= 11
        AND right(phone_digits, 11) = right(v_norm, 11)
    LOOP
      v_total := v_total + COALESCE(
        public.resolve_wait_response(v_lead.id, p_organization_id, p_channel),
        0
      );
    END LOOP;
  END IF;

  RETURN v_total;
END;
$$;

COMMENT ON FUNCTION public.resolve_wait_response_by_phone(text, uuid, text) IS
  'Phone-keyed variant of resolve_wait_response. Called by WhatsApp/SZ-Chat '
  'webhooks on incoming message to advance workflow executions waiting on a '
  'reply. Uses 3-tier match cascade (exact phone_digits → normalize_br_mobile '
  '→ right-11 suffix) to handle BR mobile 9-prefix variance.';

REVOKE ALL ON FUNCTION public.resolve_wait_response_by_phone(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_wait_response_by_phone(text, uuid, text) TO service_role;
