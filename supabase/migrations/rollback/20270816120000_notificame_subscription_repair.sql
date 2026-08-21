-- Rollback de 20270816120000_notificame_subscription_repair.sql
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  ⛔ ORDEM — FUNÇÕES PRIMEIRO, ESTE ARQUIVO DEPOIS (o inverso do apply).   ║
-- ║                                                                          ║
-- ║   1º  redeploy de `notificame-channel-finish` numa versão que NÃO         ║
-- ║       carimbe as colunas `inbound_subscription_*`;                        ║
-- ║   2º  tirar `notificame-subscription-repair` do ar;                       ║
-- ║   3º  este arquivo.                                                       ║
-- ║                                                                          ║
-- ║  Invertido, o finish novo sobre schema velho ainda NÃO derruba o vínculo  ║
-- ║  (as guardas de notificame-schema-guard reconhecem 42703/PGRST204 pelo    ║
-- ║  nome da coluna) — mas o worker passa a errar a cada 5 minutos.           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ O QUE ESTE ROLLBACK DESTRÓI, E NÃO VOLTA:
--
-- Quais canais estão CONECTADOS SEM RECEBER. Depois deste arquivo, um canal com
-- a subscription falha fica indistinguível de um canal saudável — que é
-- exatamente o defeito que a migration fecha. As linhas de `messaging_channels`
-- sobrevivem; o que morre é a única resposta para "este canal recebe?".
--
-- ANOTE ANTES, se houver QUALQUER canal social:
--
--   SELECT id, organization_id, external_channel_id,
--          inbound_subscription_status, inbound_subscription_attempts,
--          inbound_subscription_last_error, inbound_subscription_registered_at
--     FROM public.messaging_channels
--    WHERE inbound_subscription_status <> 'active';
--
-- ⚠️ E ATENÇÃO À SUBSCRIPTION DO OUTRO LADO: o registro em
-- `POST /v1/subscriptions` VIVE NO FORNECEDOR e não é tocado por nada aqui.
-- Este arquivo não desregistra nada — o webhook continua recebendo. Se a intenção
-- é PARAR de receber, isso é ato no painel do NotificaMe, separado deste rollback.

-- 1. Cron.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notificame-subscription-repair') THEN
      PERFORM cron.unschedule('notificame-subscription-repair');
    END IF;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.invoke_notificame_subscription_repair();

DELETE FROM public.cron_config WHERE key = 'notificame_subscription_repair_url';

-- 2. Índice.
DROP INDEX IF EXISTS public.idx_messaging_channels_subscription_due;

-- 3. Devolve o estado ao jsonb ANTES de apagar as colunas — sem isto, o passo 4
--    é a perda descrita no cabeçalho. Reconstitui o formato que a fatia 2-IG
--    escrevia, para que uma reaplicação da migration reencontre o backfill.
UPDATE public.messaging_channels
   SET provider_config = provider_config || jsonb_build_object(
         'subscription', jsonb_strip_nulls(jsonb_build_object(
           'status',          inbound_subscription_status,
           'registered_at',   inbound_subscription_registered_at,
           'last_error_code', inbound_subscription_last_error,
           'event_types',     jsonb_build_array('MESSAGE')
         ))
       )
 WHERE inbound_subscription_status <> 'pending';

-- 4. Colunas.
ALTER TABLE public.messaging_channels
  DROP CONSTRAINT IF EXISTS chk_messaging_channels_inbound_subscription_status;

ALTER TABLE public.messaging_channels
  DROP COLUMN IF EXISTS inbound_subscription_registered_at,
  DROP COLUMN IF EXISTS inbound_subscription_next_attempt_at,
  DROP COLUMN IF EXISTS inbound_subscription_last_attempt_at,
  DROP COLUMN IF EXISTS inbound_subscription_last_error,
  DROP COLUMN IF EXISTS inbound_subscription_attempts,
  DROP COLUMN IF EXISTS inbound_subscription_status;
