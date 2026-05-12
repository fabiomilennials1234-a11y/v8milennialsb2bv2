-- Auto-link whatsapp_messages to leads by phone number.
--
-- 1. Generated column on leads: phone_digits (digits-only, indexed)
-- 2. BEFORE INSERT trigger on whatsapp_messages: resolve lead_id from phone
-- 3. Backfill existing messages without lead_id

-- ============================================================
-- 1. Generated column + index on leads
-- ============================================================

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS phone_digits text
  GENERATED ALWAYS AS (regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')) STORED;

CREATE INDEX IF NOT EXISTS idx_leads_org_phone_digits
  ON public.leads(organization_id, phone_digits)
  WHERE phone_digits != '';

-- ============================================================
-- 2. Trigger function: resolve lead_id from phone_number
-- ============================================================

CREATE OR REPLACE FUNCTION public.resolve_message_lead_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  resolved_id uuid;
  digits text;
  suffix11 text;
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  digits := regexp_replace(COALESCE(NEW.phone_number, ''), '[^0-9]', '', 'g');
  IF digits = '' THEN
    RETURN NEW;
  END IF;

  -- Exact match on full digits
  SELECT l.id INTO resolved_id
  FROM leads l
  WHERE l.organization_id = NEW.organization_id
    AND l.phone_digits = digits
    AND l.phone_digits != ''
  LIMIT 1;

  -- Suffix match: last 11 digits (BR mobile with area code)
  IF resolved_id IS NULL AND length(digits) >= 10 THEN
    suffix11 := right(digits, 11);
    SELECT l.id INTO resolved_id
    FROM leads l
    WHERE l.organization_id = NEW.organization_id
      AND l.phone_digits != ''
      AND length(l.phone_digits) >= 10
      AND right(l.phone_digits, 11) = suffix11
    LIMIT 1;
  END IF;

  -- Suffix match: last 10 digits (BR landline or missing 9th digit)
  IF resolved_id IS NULL AND length(digits) >= 10 THEN
    SELECT l.id INTO resolved_id
    FROM leads l
    WHERE l.organization_id = NEW.organization_id
      AND l.phone_digits != ''
      AND length(l.phone_digits) >= 10
      AND right(l.phone_digits, 10) = right(digits, 10)
    LIMIT 1;
  END IF;

  IF resolved_id IS NOT NULL THEN
    NEW.lead_id := resolved_id;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 3. Trigger (BEFORE INSERT — modifies NEW directly)
-- ============================================================

DROP TRIGGER IF EXISTS trg_resolve_message_lead_id ON public.whatsapp_messages;
CREATE TRIGGER trg_resolve_message_lead_id
  BEFORE INSERT ON public.whatsapp_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.resolve_message_lead_id();

-- ============================================================
-- 4. Backfill existing messages without lead_id
-- ============================================================

UPDATE public.whatsapp_messages wm
SET lead_id = l.id
FROM public.leads l
WHERE wm.lead_id IS NULL
  AND wm.organization_id = l.organization_id
  AND l.phone_digits != ''
  AND l.phone_digits = regexp_replace(COALESCE(wm.phone_number, ''), '[^0-9]', '', 'g');

-- Suffix-11 backfill for remaining unlinked
UPDATE public.whatsapp_messages wm
SET lead_id = sub.lead_id
FROM (
  SELECT DISTINCT ON (wm2.id) wm2.id as msg_id, l2.id as lead_id
  FROM public.whatsapp_messages wm2
  JOIN public.leads l2
    ON l2.organization_id = wm2.organization_id
    AND l2.phone_digits != ''
    AND length(l2.phone_digits) >= 10
    AND right(l2.phone_digits, 11) = right(regexp_replace(COALESCE(wm2.phone_number, ''), '[^0-9]', '', 'g'), 11)
  WHERE wm2.lead_id IS NULL
    AND length(regexp_replace(COALESCE(wm2.phone_number, ''), '[^0-9]', '', 'g')) >= 10
  ORDER BY wm2.id, l2.created_at DESC
) sub
WHERE wm.id = sub.msg_id;
