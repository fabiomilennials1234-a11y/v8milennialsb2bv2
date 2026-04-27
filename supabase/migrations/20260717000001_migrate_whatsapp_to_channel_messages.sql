-- =============================================================================
-- Migration: Migrar dados de whatsapp_messages para channel_messages
-- =============================================================================

-- Copiar todos os dados existentes
INSERT INTO channel_messages (
  organization_id,
  channel,
  instance_id,
  external_id,
  remote_jid,
  phone_number,
  sender_name,
  direction,
  message_type,
  content,
  media_url,
  status,
  lead_id,
  timestamp,
  created_at,
  raw_payload
)
SELECT
  organization_id,
  'whatsapp'::channel_type,
  instance_id,
  message_id,
  remote_jid,
  phone_number,
  push_name,
  direction,
  message_type,
  content,
  media_url,
  status,
  lead_id,
  timestamp,
  created_at,
  raw_payload
FROM whatsapp_messages
ON CONFLICT (external_id, channel, organization_id) DO NOTHING;

-- Nota: a tabela whatsapp_messages NAO e removida nesta migration.
-- Ela sera mantida temporariamente para rollback seguro.
-- Uma migration futura pode dropa-la apos validacao completa.
