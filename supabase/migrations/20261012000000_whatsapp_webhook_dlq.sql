-- whatsapp_webhook_dlq — dead letter queue for inbound Uazapi events that
-- could not be processed on first delivery.
--
-- Producer: supabase/functions/whatsapp-webhook/ writes a row here in the
--   `uazapi_missing_instance` / `uazapi_unknown_instance` branches before
--   returning 200. Previously those events were dropped silently — the
--   2026-05-14 incident lost ~3900 messages this way.
--
-- Consumer: supabase/functions/whatsapp-dlq-replay/ runs every 5 minutes via
--   pg_cron, retries resolution + insertion, and stamps `resolved_at` on
--   success. After 5 failed attempts the row is left for manual review and
--   surfaced via Sentry alert.
--
-- Access: service_role only. No app-tier reads or writes.

CREATE TABLE IF NOT EXISTS public.whatsapp_webhook_dlq (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at           timestamptz NOT NULL DEFAULT now(),
  source_ip             text,
  url_path              text,
  event                 text,
  reason                text NOT NULL,
  payload               jsonb NOT NULL,
  attempts              integer NOT NULL DEFAULT 0,
  last_attempt_at       timestamptz,
  last_error            text,
  resolved_at           timestamptz,
  resolved_instance_id  uuid REFERENCES public.whatsapp_instances(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_dlq_pending
  ON public.whatsapp_webhook_dlq (received_at)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_dlq_reason
  ON public.whatsapp_webhook_dlq (reason, received_at DESC);

ALTER TABLE public.whatsapp_webhook_dlq ENABLE ROW LEVEL SECURITY;

-- Deny-all RLS — only service_role (which bypasses RLS) can read or write.
-- No policies needed; default is deny.

COMMENT ON TABLE public.whatsapp_webhook_dlq IS
  'Dead letter queue for Uazapi webhook events that failed initial processing. '
  'Replayed every 5 minutes by whatsapp-dlq-replay. service_role only.';

COMMENT ON COLUMN public.whatsapp_webhook_dlq.reason IS
  'Why the event was queued. Allowed values include: missing_instance, '
  'unknown_instance, parse_error, downstream_error. Free-form text — no '
  'CHECK constraint so the producer can add new reasons without migrations.';

COMMENT ON COLUMN public.whatsapp_webhook_dlq.attempts IS
  'Number of replay attempts. 5 attempts → Sentry critical + manual review.';
