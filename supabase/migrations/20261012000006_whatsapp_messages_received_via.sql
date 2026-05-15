-- whatsapp_messages.received_via — provenance of each inserted message.
--
-- Allows the operator dashboard and audits to distinguish messages received
-- via the live webhook from those backfilled by history-sync or replayed from
-- the DLQ. Useful for sizing future drift, validating recovery, and Sentry
-- triage.
--
-- Values:
--   'webhook'       — live ingress via whatsapp-webhook (default)
--   'history_sync'  — backfill via history-sync-worker
--   'dlq_replay'    — replay via whatsapp-dlq-replay
--   'manual_replay' — operator-triggered replay (future)

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS received_via text NOT NULL DEFAULT 'webhook';

-- No CHECK constraint — the producer-set is small and stable but new
-- recovery paths should not require a migration.

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_received_via
  ON public.whatsapp_messages (received_via, created_at DESC)
  WHERE received_via <> 'webhook';

COMMENT ON COLUMN public.whatsapp_messages.received_via IS
  'Which writer produced this row. webhook (default), history_sync, '
  'dlq_replay, manual_replay. No CHECK so new recovery paths do not require '
  'migrations.';
