-- =============================================================================
-- Migration: copilot_processing_locks + copilot_message_queue
-- Fix para vídeos duplicados do copilot: DB-level lock cross-isolate +
-- message batching queue com trigger pg_net.
-- Issue: #201 | Parent: #200
-- Date: 2026-05-18
-- =============================================================================

-- 1. Processing locks — substitui in-memory Map do agent-message
CREATE TABLE public.copilot_processing_locks (
  phone text NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  locked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (phone, organization_id)
);

CREATE INDEX idx_copilot_processing_locks_expiry
  ON public.copilot_processing_locks (locked_at);

ALTER TABLE public.copilot_processing_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON public.copilot_processing_locks
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.copilot_processing_locks IS
  'Cross-isolate processing lock para copilot. Upsert com window 60s. Substitui inFlightMap.';

-- 2. Message queue — batching de msgs do lead antes de chamar LLM
CREATE TABLE public.copilot_message_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.channel_messages(id) ON DELETE CASCADE,
  phone text NOT NULL,
  queued_at timestamptz NOT NULL DEFAULT now(),
  batch_key text GENERATED ALWAYS AS (phone || ':' || organization_id::text) STORED,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_copilot_message_queue_batch
  ON public.copilot_message_queue (batch_key, status, queued_at)
  WHERE status = 'pending';

CREATE INDEX idx_copilot_message_queue_cleanup
  ON public.copilot_message_queue (processed_at)
  WHERE status = 'done';

ALTER TABLE public.copilot_message_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON public.copilot_message_queue
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.copilot_message_queue IS
  'Fila de mensagens para batching do copilot. INSERT trigger dispara batch processor via pg_net.';

-- 3. RPC: acquire processing lock (upsert com 60s window)
CREATE OR REPLACE FUNCTION public.acquire_copilot_lock(
  p_phone text,
  p_organization_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_affected int;
BEGIN
  INSERT INTO copilot_processing_locks (phone, organization_id, locked_at)
  VALUES (p_phone, p_organization_id, now())
  ON CONFLICT (phone, organization_id)
  DO UPDATE SET locked_at = now()
  WHERE copilot_processing_locks.locked_at < now() - interval '60 seconds';

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  RETURN v_affected > 0;
END;
$$;

COMMENT ON FUNCTION public.acquire_copilot_lock IS
  'Tenta adquirir lock de processing para phone+org. Retorna true se adquiriu, false se lock ativo (<60s).';

-- 4. RPC: claim batch from queue (atomic, skip locked)
CREATE OR REPLACE FUNCTION public.claim_copilot_batch(
  p_batch_key text
)
RETURNS SETOF public.copilot_message_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE copilot_message_queue
  SET status = 'processing'
  WHERE id IN (
    SELECT id
    FROM copilot_message_queue
    WHERE batch_key = p_batch_key
      AND status = 'pending'
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

COMMENT ON FUNCTION public.claim_copilot_batch IS
  'Claim atômico de batch pendente por batch_key. FOR UPDATE SKIP LOCKED garante idempotência.';

-- 5. Trigger: on INSERT, fire pg_net to batch processor
CREATE OR REPLACE FUNCTION public.notify_copilot_batch_processor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_worker_url text;
  v_secret_val text;
BEGIN
  SELECT value INTO v_worker_url FROM public.cron_config WHERE key = 'copilot_batch_processor_url';
  SELECT value INTO v_secret_val FROM public.cron_config WHERE key = 'cron_secret';

  IF v_worker_url IS NOT NULL AND v_worker_url != '' THEN
    PERFORM net.http_post(
      url := v_worker_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', COALESCE(v_secret_val, '')
      ),
      body := jsonb_build_object('batch_key', NEW.batch_key)
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_copilot_message_queue_notify
  AFTER INSERT ON public.copilot_message_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_copilot_batch_processor();

COMMENT ON FUNCTION public.notify_copilot_batch_processor IS
  'Trigger: notifica copilot-batch-processor via pg_net após INSERT na queue. Fire-and-forget.';

-- 6. cron_config entry (prod URL)
INSERT INTO public.cron_config (key, value)
VALUES ('copilot_batch_processor_url', 'https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/copilot-batch-processor')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
