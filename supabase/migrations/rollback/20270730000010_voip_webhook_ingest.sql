-- ROLLBACK pareado de 20270730000010_voip_webhook_ingest.sql
--
-- Remove a aplicação do evento assinado da VPS: a RPC, a tabela de reserva de
-- jti, o job de limpeza dela e as duas colunas de marca d'água em
-- `voip_sessions`.
--
-- ANTES DE RODAR ISTO, SAIBA O QUE ACONTECE
-- -----------------------------------------
-- O endpoint `torquecalls-webhook` (T8) chama `fn_voip_apply_vps_event` e passa
-- a receber `function does not exist` — toda entrega da VPS vira 500, e a VPS
-- retenta. Desligue o webhook do lado da VPS ANTES
-- (`TORQUECALLS_WEBHOOK_URL` vazia deixa o emissor inerte), ou este rollback
-- troca "sem transição autoritativa" por "sem transição autoritativa E com
-- rajada de 500".
--
-- E volta a valer o mundo em que a única coisa que fecha uma chamada é o botão
-- de desligar da aba mais o varredor `voip-sweep-stuck-calls`
-- (20270730000007). O varredor NÃO é removido aqui de propósito: sem o webhook
-- ele volta a ser a única rede de segurança que devolve o operador preso pelo
-- UNIQUE parcial `idx_voip_calls_one_live_per_operator`.
--
-- O QUE SE PERDE COM O `DROP TABLE`
-- ---------------------------------
-- `voip_webhook_events` é efêmera por construção (linha vive 60 min e o cron
-- apaga). Perder o conteúdo não perde história — perde só a janela de dedup
-- corrente. Se o webhook for religado logo depois, os envelopes ainda válidos
-- (TTL de 300 s) poderiam ser aplicados uma segunda vez. Espere os 5 minutos.
--
-- As colunas de marca d'água caem junto: mantê-las sem a RPC deixaria dois
-- inteiros que ninguém escreve nem lê, e o próximo agente gastaria um dia
-- descobrindo que são fósseis. Consequência de religar depois: a marca d'água
-- volta a 0 e os eventos vivos do epoch corrente são todos aceitos uma vez.

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'voip-webhook-events-cleanup') THEN
    PERFORM cron.unschedule('voip-webhook-events-cleanup');
  END IF;
END
$cron$;

DROP FUNCTION IF EXISTS public.fn_voip_apply_vps_event(uuid, text, bigint, bigint, timestamptz, jsonb);

DROP TABLE IF EXISTS public.voip_webhook_events;

ALTER TABLE public.voip_sessions DROP COLUMN IF EXISTS last_seq_epoch;
ALTER TABLE public.voip_sessions DROP COLUMN IF EXISTS last_seq;
