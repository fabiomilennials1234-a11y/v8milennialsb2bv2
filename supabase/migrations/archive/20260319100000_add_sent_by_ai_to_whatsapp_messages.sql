-- Add sent_by_ai flag to distinguish Copilot messages from human messages
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS sent_by_ai BOOLEAN DEFAULT false;

-- Partial index: only index the few AI messages for efficient filtering
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_sent_by_ai
  ON public.whatsapp_messages(sent_by_ai) WHERE sent_by_ai = true;
