-- ROLLBACK de 20260726120000_send_dedup_log.sql (#fix wa-ratelimit-dedup)
--
-- Aditiva → rollback = DROP. Ordem: cron antes da tabela (o job referencia a
-- tabela). O DROP TABLE apaga reservas em voo — inofensivo: send_dedup_log é
-- estado efêmero (linhas expiram em minutos), não dado de cliente. Reverter só
-- reabre o furo de dedup (fail-open volta a engolir tudo).

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-dedup-log-cleanup') THEN
    PERFORM cron.unschedule('send-dedup-log-cleanup');
  END IF;
END
$cron$;

DROP TABLE IF EXISTS public.send_dedup_log CASCADE;
