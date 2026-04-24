-- Sprint 1 — Message actions metadata
-- Adiciona colunas para suportar react/edit/pin/delete/markRead no whatsapp_messages.
-- Alinhado com whatsapp-webhook handleMessagesUpdateEvent (que já pode UPDATE
-- edited/deleted/status) e expostas pelo frontend via MessageBubble.

-- Rollback:
-- ALTER TABLE public.whatsapp_messages
--   DROP COLUMN IF EXISTS reactions,
--   DROP COLUMN IF EXISTS edited,
--   DROP COLUMN IF EXISTS pinned_at,
--   DROP COLUMN IF EXISTS deleted_at;

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS reactions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS edited BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Index para consultas de mensagens fixadas por conversa
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_pinned
  ON public.whatsapp_messages (instance_id, remote_jid)
  WHERE pinned_at IS NOT NULL;

-- Comment documenta semântica
COMMENT ON COLUMN public.whatsapp_messages.reactions IS
  'Array of { emoji: string, from: "me" | "them", count: number }. Updated by whatsapp-webhook messages_update handler.';
COMMENT ON COLUMN public.whatsapp_messages.edited IS
  'True when sender edited the message via provider. Set by webhook messages_update.';
COMMENT ON COLUMN public.whatsapp_messages.pinned_at IS
  'When the message was pinned in the chat. Null = not pinned.';
COMMENT ON COLUMN public.whatsapp_messages.deleted_at IS
  'When the message was deleted for all. UI should render strikethrough or placeholder.';
