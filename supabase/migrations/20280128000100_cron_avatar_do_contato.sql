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
-- Gate de trabalho: só chama a edge fn se houver linha que o claim pegaria
-- (mesmos filtros) ou arquivo na fila de remoção — hora ociosa não gasta
-- invocação.
--
-- Kill switch do fallback POST /chat/details: cron_config
-- key='contact_avatar_chat_details'. Esta migration NÃO insere a chave:
-- ausente = DESLIGADO. Ligar só depois de capturar um fixture real da resposta:
--   INSERT INTO public.cron_config (key, value) VALUES ('contact_avatar_chat_details', 'on')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

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
  -- Espelha os filtros de public.reivindicar_avatares (20280128000000): sem
  -- isso o gate seria quase sempre verdadeiro (pendente em recuo, já
  -- reivindicada ou de conversa velha) e a edge fn rodaria em vão. Mudou lá,
  -- muda aqui — tests/unit/avatar-do-contato-migration.test.ts compara os dois.
  IF NOT EXISTS (SELECT 1 FROM public.contact_avatar_storage_deletions)
     AND NOT EXISTS (
       SELECT 1 FROM public.whatsapp_contact_avatars a
       WHERE (a.claimed_until IS NULL OR a.claimed_until < now())
         AND ((a.status = 'pending' AND (a.retry_after IS NULL OR a.retry_after <= now()))
              OR (a.status <> 'pending' AND a.avatar_updated_at < now() - interval '7 days'))
         AND EXISTS (
           SELECT 1 FROM public.whatsapp_instances wi
           JOIN public.whatsapp_conversation_summary s
             ON s.organization_id = wi.organization_id AND s.instance_id = wi.id
            AND s.normalized_phone = a.normalized_phone
           WHERE wi.organization_id = a.organization_id
             AND s.last_message_time > now() - interval '30 days')
     ) THEN
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
