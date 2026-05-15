-- whatsapp_media_jobs — DLQ for media downloads from the Uazapi CDN.
--
-- Producer: supabase/functions/whatsapp-webhook/ enqueues a row when a message
--   arrives with a WhatsApp CDN URL that needs to be downloaded and re-hosted
--   in Storage. The webhook attempts the download inline (best-effort) and
--   stamps the row on success. If the inline attempt fails (timeout, CDN
--   error, storage error) the row remains pending for the retry worker.
--
-- Consumer: supabase/functions/whatsapp-media-retry/ runs every 2 minutes via
--   pg_cron, processes pending rows in batches, retries the download and
--   storage upload, and stamps `resolved_at` + `storage_path` on success.
--   After 5 failed attempts the row is left for manual review and surfaced
--   via Sentry alert.
--
-- Why this exists: the WhatsApp media CDN expires download URLs after ~14
-- days. A failed first-attempt persist used to lose the media permanently
-- (fire-and-forget) — we now retry until the deadline.
--
-- Access: service_role only. No app-tier reads or writes.

CREATE TABLE IF NOT EXISTS public.whatsapp_media_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      text NOT NULL,
  instance_id     uuid NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_url      text NOT NULL,
  message_type    text,
  attempts        integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  last_error      text,
  resolved_at     timestamptz,
  storage_path    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, instance_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_media_jobs_pending
  ON public.whatsapp_media_jobs (created_at)
  WHERE resolved_at IS NULL AND attempts < 5;

CREATE INDEX IF NOT EXISTS idx_whatsapp_media_jobs_exhausted
  ON public.whatsapp_media_jobs (last_attempt_at DESC)
  WHERE resolved_at IS NULL AND attempts >= 5;

ALTER TABLE public.whatsapp_media_jobs ENABLE ROW LEVEL SECURITY;
-- Deny-all RLS — only service_role can read/write.

COMMENT ON TABLE public.whatsapp_media_jobs IS
  'DLQ for WhatsApp CDN media downloads. Drained every 2 minutes by '
  'whatsapp-media-retry. service_role only.';

COMMENT ON COLUMN public.whatsapp_media_jobs.attempts IS
  'Number of download attempts. After 5 failed attempts the row is exhausted '
  'and surfaced via Sentry critical for manual review.';

COMMENT ON COLUMN public.whatsapp_media_jobs.storage_path IS
  'Final path inside the Storage bucket once the media has been persisted '
  '(e.g. "whatsapp-media/<org_id>/<message_id>.<ext>"). NULL while pending.';
