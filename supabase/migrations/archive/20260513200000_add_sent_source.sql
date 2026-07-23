-- Add sent_source column to whatsapp_messages
ALTER TABLE whatsapp_messages
ADD COLUMN sent_source TEXT NOT NULL DEFAULT 'manual'
CHECK (sent_source IN ('manual', 'copilot', 'workflow'));

-- Backfill: existing sent_by_ai=true messages → copilot (best guess)
UPDATE whatsapp_messages SET sent_source = 'copilot' WHERE sent_by_ai = true;

-- Partial index for analytics queries on outgoing automated messages
CREATE INDEX idx_whatsapp_messages_sent_source
ON whatsapp_messages(organization_id, sent_source)
WHERE direction = 'outgoing';
