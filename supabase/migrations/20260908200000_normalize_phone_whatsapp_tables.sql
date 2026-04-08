-- =============================================================================
-- Add normalized_phone to whatsapp_messages and whatsapp_conversations
--
-- Problem: These tables store phone_number in raw format (with/without country
-- code 55, varying digit counts). This causes duplicate conversations and
-- broken lead associations when the same contact sends from different formats.
--
-- Solution: Add normalized_phone column with DB trigger that auto-computes
-- using the existing normalize_brazilian_phone() function. Backfill existing
-- data. Add indexes for fast lookups.
--
-- IMPORTANT: Only for development environment. Never run against production.
-- Idempotent — safe to run multiple times.
-- Date: 2026-04-08
-- =============================================================================

-- ============================================
-- 1. ADD normalized_phone TO whatsapp_messages
-- ============================================

ALTER TABLE public.whatsapp_messages
ADD COLUMN IF NOT EXISTS normalized_phone TEXT;

-- Trigger to auto-normalize on insert/update
CREATE OR REPLACE FUNCTION public.normalize_whatsapp_message_phone()
RETURNS TRIGGER AS $$
BEGIN
  NEW.normalized_phone := public.normalize_brazilian_phone(NEW.phone_number);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

DROP TRIGGER IF EXISTS trg_normalize_whatsapp_message_phone ON public.whatsapp_messages;
CREATE TRIGGER trg_normalize_whatsapp_message_phone
  BEFORE INSERT OR UPDATE OF phone_number ON public.whatsapp_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_whatsapp_message_phone();

-- Index for lookups by normalized phone
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_normalized_phone
  ON public.whatsapp_messages(organization_id, normalized_phone)
  WHERE normalized_phone IS NOT NULL;

-- Backfill existing data
UPDATE public.whatsapp_messages
SET normalized_phone = public.normalize_brazilian_phone(phone_number)
WHERE normalized_phone IS NULL
  AND phone_number IS NOT NULL;

-- ============================================
-- 2. ADD normalized_phone TO whatsapp_conversations
-- ============================================

ALTER TABLE public.whatsapp_conversations
ADD COLUMN IF NOT EXISTS normalized_phone TEXT;

-- Trigger to auto-normalize on insert/update
CREATE OR REPLACE FUNCTION public.normalize_whatsapp_conversation_phone()
RETURNS TRIGGER AS $$
BEGIN
  NEW.normalized_phone := public.normalize_brazilian_phone(NEW.phone_number);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

DROP TRIGGER IF EXISTS trg_normalize_whatsapp_conversation_phone ON public.whatsapp_conversations;
CREATE TRIGGER trg_normalize_whatsapp_conversation_phone
  BEFORE INSERT OR UPDATE OF phone_number ON public.whatsapp_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_whatsapp_conversation_phone();

-- Index for lookups by normalized phone
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_normalized_phone
  ON public.whatsapp_conversations(organization_id, instance_id, normalized_phone)
  WHERE normalized_phone IS NOT NULL;

-- Backfill existing data
UPDATE public.whatsapp_conversations
SET normalized_phone = public.normalize_brazilian_phone(phone_number)
WHERE normalized_phone IS NULL
  AND phone_number IS NOT NULL;

-- ============================================
-- 3. VERIFICATION
-- ============================================

DO $$
DECLARE
  v_msg_null INT;
  v_conv_null INT;
  v_msg_total INT;
  v_conv_total INT;
BEGIN
  SELECT COUNT(*) INTO v_msg_total FROM public.whatsapp_messages;
  SELECT COUNT(*) INTO v_msg_null FROM public.whatsapp_messages WHERE normalized_phone IS NULL AND phone_number IS NOT NULL;
  SELECT COUNT(*) INTO v_conv_total FROM public.whatsapp_conversations;
  SELECT COUNT(*) INTO v_conv_null FROM public.whatsapp_conversations WHERE normalized_phone IS NULL AND phone_number IS NOT NULL;

  RAISE NOTICE '=== Phone Normalization Results ===';
  RAISE NOTICE 'whatsapp_messages: % total, % still null', v_msg_total, v_msg_null;
  RAISE NOTICE 'whatsapp_conversations: % total, % still null', v_conv_total, v_conv_null;
END $$;
