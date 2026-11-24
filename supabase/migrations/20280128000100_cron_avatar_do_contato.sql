-- 20280128000100_cron_avatar_do_contato.sql
--
-- Agenda o cron da foto do contato WhatsApp (edge fn contact-avatar-sync).
-- ROLLBACK pareado: rollback/20280128000100_cron_avatar_do_contato.sql
-- Depende de 20280128000000 (tabela, fila e RPCs).
--
-- Agenda: minutos 30 e 41 de toda hora. O desenho pedia a cada 10 min, mas o
-- contrato de carga (tests/unit/cron-escalonamento-contrato.test.ts: pico ≤ 8
-- disparos/min e nenhuma colisão com purga pesada) só deixa livres os minutos
-- 30, 40 e 41 da hora — medido com scripts/cron/carga-por-minuto.mjs sobre o
-- snapshot de prod + agendamentos posteriores. Cada rodada drena até 4 lotes
-- de 25 dentro de ~45 s, então 2 rodadas/h cobrem até 200 fotos/h.
--
-- Gate de trabalho: só chama a edge fn se houver pendente, revisita vencida ou
-- arquivo na fila de remoção — hora ociosa não gasta invocação.

CREATE OR REPLACE FUNCTION public.invoke_contact_avatar_sync()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_url    text;
  v_secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_contact_avatars WHERE status = 'pending')
     AND NOT EXISTS (SELECT 1 FROM public.contact_avatar_storage_deletions)
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_contact_avatars
                     WHERE avatar_updated_at < now() - interval '7 days') THEN
    RETURN;
  END IF;

  SELECT value INTO v_url    FROM public.cron_config WHERE key = 'campaign_rule_dispatch_url';
  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';
  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING '[contact-avatar-sync] cron_config incomplete: url=%, secret_present=%',
      v_url IS NOT NULL, v_secret IS NOT NULL;
    RETURN;
  END IF;

  v_url := replace(v_url, 'campaign-rule-dispatch', 'contact-avatar-sync');

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[contact-avatar-sync] invoke failed: %', SQLERRM;
END;
$function$;

REVOKE ALL ON FUNCTION public.invoke_contact_avatar_sync() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_contact_avatar_sync() TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN;
  END IF;
  PERFORM cron.schedule('contact-avatar-sync', '30,41 * * * *', 'SELECT public.invoke_contact_avatar_sync();');
END $$;
