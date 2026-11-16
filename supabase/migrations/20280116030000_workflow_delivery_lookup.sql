-- The delivery guard polls only opted-in executions. Avoid scanning all of an
-- organization's message history for each pending movement.
SET lock_timeout = '2s';
-- Measured before rollout: ~79k rows, 99 MB heap. Bound the entire build to
-- three seconds; abort and plan a concurrent rollout if it cannot fit.
SET statement_timeout = '3s';
CREATE INDEX IF NOT EXISTS idx_channel_messages_workflow_delivery
ON public.channel_messages (organization_id, ((metadata->'origem')->>'id'), created_at DESC)
WHERE channel = 'whatsapp' AND direction = 'outgoing';
