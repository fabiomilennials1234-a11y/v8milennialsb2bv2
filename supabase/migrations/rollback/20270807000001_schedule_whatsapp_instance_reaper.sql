-- =============================================================================
-- ROLLBACK de 20270807000001_schedule_whatsapp_instance_reaper.sql (#1476)
--
-- ATENÇÃO: sem o cron, as lápides param de ser drenadas. A fila continua correta
-- e nada se perde, mas nenhuma Instance é removida no provider até o coletor
-- voltar. Confira o tamanho da fila antes e depois:
--
--   SELECT count(*) FROM public.whatsapp_instance_reap_queue
--    WHERE confirmed_at IS NULL AND gave_up_at IS NULL;
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'whatsapp_instance_reaper') THEN
    PERFORM cron.unschedule('whatsapp_instance_reaper');
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.invoke_whatsapp_instance_reaper();
