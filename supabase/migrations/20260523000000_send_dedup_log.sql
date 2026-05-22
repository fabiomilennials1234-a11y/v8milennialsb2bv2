-- send_dedup_log — idempotência atômica para todo caminho de envio.
--
-- Telemetria investigação Bertin (2026-05-22): 12x "Oi Filipe!" via composer
-- em 30min; 3000+ msgs em loop bot-to-bot em 9h. Causas: ausência de dedup
-- entre múltiplos caminhos (whatsapp-api-proxy, outbound-sender,
-- workflow-executor, copilot/dispatcher) sem orquestração compartilhada.
--
-- Este módulo dá ao caller uma reserva atômica antes de bater no provider.
-- Race-free via partial unique indexes + ON CONFLICT DO NOTHING.

CREATE TABLE public.send_dedup_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  phone           text NOT NULL,
  content_hash    text NOT NULL,
  source          text NOT NULL CHECK (source IN ('manual','copilot','workflow','mass_send','followup')),
  idempotency_key text,
  reserved_at     timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL
);

CREATE INDEX idx_send_dedup_log_org_id ON public.send_dedup_log(org_id);
CREATE INDEX idx_send_dedup_log_expires_at ON public.send_dedup_log(expires_at);

-- Content-hash dedup: ativo quando o caller NÃO passa idempotency_key.
-- Combinado com cron de limpeza (rows com expires_at < now() são purgadas).
-- Partial unique não pode referenciar now(); cobertura via cron.
CREATE UNIQUE INDEX idx_send_dedup_log_content_partial
  ON public.send_dedup_log (org_id, phone, content_hash, source)
  WHERE idempotency_key IS NULL;

-- Idempotency-key dedup: replay com mesma key é noop ok.
CREATE UNIQUE INDEX idx_send_dedup_log_idk_partial
  ON public.send_dedup_log (org_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.send_dedup_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_select" ON public.send_dedup_log
  FOR SELECT USING (org_id = auth.org_id());

CREATE POLICY "tenant_isolation_all" ON public.send_dedup_log
  FOR ALL
  USING (org_id = auth.org_id())
  WITH CHECK (org_id = auth.org_id());

GRANT SELECT, INSERT ON public.send_dedup_log TO authenticated;
GRANT ALL ON public.send_dedup_log TO service_role;

COMMENT ON TABLE public.send_dedup_log IS
  'Atomic dedup reservation for outbound WhatsApp sends. Caller uses tryReserveSend (supabase/functions/_shared/send-dedup.ts) before hitting provider. Cleanup cron purges rows past expires_at.';

-- Cleanup cron — runs every 5 minutes, deletes expired rows. Lightweight
-- (table is high-churn and small steady state).
SELECT cron.schedule(
  'send-dedup-log-cleanup',
  '*/5 * * * *',
  $$DELETE FROM public.send_dedup_log WHERE expires_at < now() - interval '1 minute'$$
);
