-- Auto-link whatsapp_messages to leads by phone number.
--
-- 1. Generated column on leads: phone_digits (digits-only, indexed)
-- 2. BR phone normalization function (handles 9th digit differences)
-- 3. BEFORE INSERT trigger on whatsapp_messages: resolve lead_id from phone
-- 4. Backfill existing messages without lead_id

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
-- 2. BR mobile phone normalization (9th digit aware)
-- ============================================================

CREATE OR REPLACE FUNCTION public.normalize_br_mobile(digits text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE
    WHEN length(digits) = 13 AND left(digits, 2) = '55' THEN digits
    WHEN length(digits) = 12 AND left(digits, 2) = '55'
    THEN left(digits, 4) || '9' || substr(digits, 5)
    WHEN length(digits) = 11 AND substr(digits, 3, 1) = '9'
    THEN '55' || digits
    WHEN length(digits) = 10
    THEN '55' || left(digits, 2) || '9' || substr(digits, 3)
    ELSE digits
  END;
$$;

-- ============================================================
-- 3. Trigger function: resolve lead_id from phone_number
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
  normalized text;
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

  -- BR mobile normalization match (handles 9th digit differences)
  IF resolved_id IS NULL AND length(digits) >= 10 THEN
    normalized := normalize_br_mobile(digits);
    SELECT l.id INTO resolved_id
    FROM leads l
    WHERE l.organization_id = NEW.organization_id
      AND l.phone_digits != ''
      AND length(l.phone_digits) >= 10
      AND normalize_br_mobile(l.phone_digits) = normalized
    LIMIT 1;
  END IF;

  -- Suffix match: last 11 digits (fallback for international numbers)
  IF resolved_id IS NULL AND length(digits) >= 10 THEN
    SELECT l.id INTO resolved_id
    FROM leads l
    WHERE l.organization_id = NEW.organization_id
      AND l.phone_digits != ''
      AND length(l.phone_digits) >= 10
      AND right(l.phone_digits, 11) = right(digits, 11)
    LIMIT 1;
  END IF;

  IF resolved_id IS NOT NULL THEN
    NEW.lead_id := resolved_id;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 4. Trigger (BEFORE INSERT — modifies NEW directly)
-- ============================================================

DROP TRIGGER IF EXISTS trg_resolve_message_lead_id ON public.whatsapp_messages;
CREATE TRIGGER trg_resolve_message_lead_id
  BEFORE INSERT ON public.whatsapp_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.resolve_message_lead_id();

-- ============================================================
-- 5. Backfill existing messages without lead_id
-- ============================================================

-- Exact digits match
UPDATE public.whatsapp_messages wm
SET lead_id = l.id
FROM public.leads l
WHERE wm.lead_id IS NULL
  AND wm.organization_id = l.organization_id
  AND l.phone_digits != ''
  AND l.phone_digits = regexp_replace(COALESCE(wm.phone_number, ''), '[^0-9]', '', 'g');

-- BR normalization match (9th digit)
UPDATE public.whatsapp_messages wm
SET lead_id = sub.lead_id
FROM (
  SELECT DISTINCT ON (wm2.id) wm2.id as msg_id, l2.id as lead_id
  FROM public.whatsapp_messages wm2
  JOIN public.leads l2
    ON l2.organization_id = wm2.organization_id
    AND l2.phone_digits != ''
    AND length(l2.phone_digits) >= 10
    AND normalize_br_mobile(l2.phone_digits) = normalize_br_mobile(
      regexp_replace(COALESCE(wm2.phone_number, ''), '[^0-9]', '', 'g')
    )
  WHERE wm2.lead_id IS NULL
    AND length(regexp_replace(COALESCE(wm2.phone_number, ''), '[^0-9]', '', 'g')) >= 10
  ORDER BY wm2.id, l2.created_at DESC
) sub
WHERE wm.id = sub.msg_id;

-- Suffix-11 backfill for remaining international numbers
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
