-- 20260726120000_send_dedup_log.sql
--
-- FIX (área frágil — WhatsApp / vetor de ban). Autorizado pelo CTO.
-- Diagnóstico: Lanterna (confirmado em prod via MCP).
--
-- O FURO
-- ------
-- `_shared/send-dedup.ts` (tryReserveSend / reserveSendOrSkip) já está no código e
-- reserva atomicamente contra `send_dedup_log` ANTES de bater no provider. Mas a
-- TABELA NUNCA FOI APLICADA em prod: o CREATE vivia só em
-- archive/20260523000000_send_dedup_log.sql e o baseline de 22/07 (dump do prod
-- real) congelou a ausência. Resultado: o wrapper é fail-open por design → toda
-- reserva cai no catch → dedup DESLIGADO. É o vetor da investigação Bertin
-- (12× "Oi Filipe!" em 30min; 3000+ msgs em loop bot-to-bot em 9h).
--
-- O QUE MUDA vs. O ARCHIVE (não é cópia cega)
-- -------------------------------------------
-- 1. O corpo é o do archive JÁ CORRIGIDO: a RLS usa get_my_organization_ids()
--    (SECURITY DEFINER, bypassa RLS, padrão da casa). O rascunho original
--    referenciava um auth.org_id() inexistente — foi por isso que nunca aplicou.
--    Deps verificadas em prod pela Lanterna: organizations OK, cron OK, tabela
--    ausente, jobname `send-dedup-log-cleanup` ausente. Zero colisão.
-- 2. O cron de limpeza passa a ser IDEMPOTENTE (guard unschedule→schedule) para
--    sobreviver a replay (db reset) sem erro de job duplicado. O archive fazia
--    `SELECT cron.schedule(...)` cru.
-- 3. Só a tabela: NÃO reaplico o resto de add_campaign_modes (campaign_templates
--    etc. já estão em prod).
--
-- FORA DESTA MIGRATION (decisão de desenho, TRAVADA no CTO): o rate-limit velho
-- (check_whatsapp_rate_limit) NÃO é revivido aqui. O Send Governor (#1156) já
-- governa todos os sends dos 3 dispatchers via governSend; a fn velha é pre-check
-- redundante. Ver relatório ao Pauta.
--
-- ROLLBACK pareado: rollback/20260726120000_send_dedup_log.sql

CREATE TABLE IF NOT EXISTS public.send_dedup_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  phone           text NOT NULL,
  content_hash    text NOT NULL,
  source          text NOT NULL CHECK (source IN ('manual','copilot','workflow','mass_send','followup')),
  idempotency_key text,
  reserved_at     timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_send_dedup_log_org_id ON public.send_dedup_log(org_id);
CREATE INDEX IF NOT EXISTS idx_send_dedup_log_expires_at ON public.send_dedup_log(expires_at);

-- Content-hash dedup: ativo quando o caller NÃO passa idempotency_key.
-- Partial unique não pode referenciar now(); a janela é coberta pelo cron de
-- limpeza (linhas com expires_at vencido são purgadas).
CREATE UNIQUE INDEX IF NOT EXISTS idx_send_dedup_log_content_partial
  ON public.send_dedup_log (org_id, phone, content_hash, source)
  WHERE idempotency_key IS NULL;

-- Idempotency-key dedup: replay com a mesma key é noop ok.
CREATE UNIQUE INDEX IF NOT EXISTS idx_send_dedup_log_idk_partial
  ON public.send_dedup_log (org_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.send_dedup_log ENABLE ROW LEVEL SECURITY;

-- Isolamento por tenant via get_my_organization_ids() (SECURITY DEFINER, bypassa
-- RLS para evitar recursão — padrão da casa). Edge functions escrevem via
-- service_role (RLS bypassada); estas policies gateiam o role authenticated.
DROP POLICY IF EXISTS "tenant_isolation_select" ON public.send_dedup_log;
CREATE POLICY "tenant_isolation_select" ON public.send_dedup_log
  FOR SELECT USING (org_id IN (SELECT get_my_organization_ids()));

DROP POLICY IF EXISTS "tenant_isolation_all" ON public.send_dedup_log;
CREATE POLICY "tenant_isolation_all" ON public.send_dedup_log
  FOR ALL
  USING (org_id IN (SELECT get_my_organization_ids()))
  WITH CHECK (org_id IN (SELECT get_my_organization_ids()));

GRANT SELECT, INSERT ON public.send_dedup_log TO authenticated;
GRANT ALL ON public.send_dedup_log TO service_role;

COMMENT ON TABLE public.send_dedup_log IS
  'Reserva atômica de dedup para envios WhatsApp. O caller usa reserveSendOrSkip '
  '(_shared/send-dedup.ts) antes de bater no provider. Cron de limpeza purga '
  'linhas vencidas. Aplicada em #fix wa-ratelimit-dedup (archive nunca aplicou).';

-- Cron de limpeza — a cada 5 min, apaga linhas vencidas. IDEMPOTENTE: reagenda
-- limpo em replay em vez de estourar por job duplicado.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-dedup-log-cleanup') THEN
    PERFORM cron.unschedule('send-dedup-log-cleanup');
  END IF;
  PERFORM cron.schedule(
    'send-dedup-log-cleanup',
    '*/5 * * * *',
    $clean$DELETE FROM public.send_dedup_log WHERE expires_at < now() - interval '1 minute'$clean$
  );
END
$cron$;
