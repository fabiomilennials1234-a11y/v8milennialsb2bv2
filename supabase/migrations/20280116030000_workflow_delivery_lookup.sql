-- The delivery guard polls only opted-in executions. Avoid scanning all of an
-- organization's message history for each pending movement.
SET lock_timeout = '2s';
SET statement_timeout = '15s';
CREATE INDEX IF NOT EXISTS idx_channel_messages_workflow_delivery
ON public.channel_messages (organization_id, ((metadata->'origem')->>'id'), created_at DESC)
WHERE channel = 'whatsapp' AND direction = 'outgoing';
