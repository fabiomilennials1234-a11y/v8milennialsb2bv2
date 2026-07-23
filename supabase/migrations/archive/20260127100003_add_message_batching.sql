-- Message Batching: permite agrupar múltiplas mensagens do lead antes de processar
-- O agente aguarda X segundos para acumular mensagens e responde tudo de uma vez

-- Coluna para marcar quando a mensagem foi processada pelo agente
ALTER TABLE public.whatsapp_messages
ADD COLUMN IF NOT EXISTS processed_by_agent_at TIMESTAMPTZ DEFAULT NULL;

-- Índice para buscar mensagens não processadas rapidamente
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_unprocessed
ON public.whatsapp_messages(organization_id, phone_number, direction)
WHERE processed_by_agent_at IS NULL;

-- Comentário explicativo
COMMENT ON COLUMN public.whatsapp_messages.processed_by_agent_at IS 
'Timestamp when this message was processed by the AI agent. NULL = not processed yet. Used for message batching - multiple messages from the same lead are grouped and processed together.';
