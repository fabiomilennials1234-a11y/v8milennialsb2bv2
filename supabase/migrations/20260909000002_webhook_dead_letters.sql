-- Webhook Dead Letter Queue
-- Failed deliveries that exceeded max_attempts are preserved here for debugging

CREATE TABLE IF NOT EXISTS public.webhook_dead_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES public.webhooks(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  payload JSONB NOT NULL,
  attempts INT NOT NULL,
  last_status_code INT,
  last_error TEXT,
  last_response_body TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),  -- when first enqueued
  failed_at TIMESTAMPTZ NOT NULL DEFAULT now()    -- when moved to dead letter
);

CREATE INDEX idx_webhook_dead_letters_webhook ON public.webhook_dead_letters(webhook_id);
CREATE INDEX idx_webhook_dead_letters_failed ON public.webhook_dead_letters(failed_at DESC);

ALTER TABLE public.webhook_dead_letters ENABLE ROW LEVEL SECURITY;

-- Same RLS as webhook_deliveries: org members can view
CREATE POLICY "Org members can view dead letters" ON public.webhook_dead_letters
  FOR SELECT USING (
    webhook_id IN (
      SELECT w.id FROM public.webhooks w
      WHERE w.organization_id IN (
        SELECT tm.organization_id FROM public.team_members tm WHERE tm.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Service role manages dead letters" ON public.webhook_dead_letters
  FOR ALL USING (true) WITH CHECK (true);

-- Add consecutive_failures counter to webhooks table for circuit breaker
ALTER TABLE public.webhooks ADD COLUMN IF NOT EXISTS consecutive_failures INT NOT NULL DEFAULT 0;
ALTER TABLE public.webhooks ADD COLUMN IF NOT EXISTS disabled_reason TEXT;
