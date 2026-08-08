-- =============================================================================
-- 20270807000001_schedule_whatsapp_instance_reaper.sql
--
-- Agenda o coletor de lápides (#1476, PRD #1472).
--
-- A lápide (#1475) preserva o token antes de a Instance morrer. Este cron é quem
-- efetivamente remove a instância no provider — em TODOS os caminhos de
-- exclusão, inclusive o CASCADE de organizations, que não passa por código de
-- aplicação nenhum.
--
-- Mesmo formato dos demais invoke_* do repo: lê a URL base e o segredo de
-- public.cron_config e dispara via pg_net. Falha de invocação vira WARNING, nunca
-- aborta a transação do cron.
--
-- ROLLBACK pareado: rollback/20270807000001_schedule_whatsapp_instance_reaper.sql
-- =============================================================================

CREATE OR REPLACE FUNCTION public.invoke_whatsapp_instance_reaper()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
BEGIN
  SELECT value INTO v_url    FROM public.cron_config WHERE key = 'campaign_rule_dispatch_url';
  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';

  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING '[whatsapp-instance-reaper] cron_config incomplete: url=%, secret_present=%',
      v_url IS NOT NULL, v_secret IS NOT NULL;
    RETURN;
  END IF;

  v_url := replace(v_url, 'campaign-rule-dispatch', 'whatsapp-instance-reaper');

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body    := '{}'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[whatsapp-instance-reaper] invoke failed: %', SQLERRM;
END;
$$;

-- CREATE FUNCTION concede EXECUTE a PUBLIC por default, e um DROP+CREATE futuro
-- reintroduz isso. Função DEFINER que dispara HTTP com o cron secret não pode
-- ficar chamável por anon.
REVOKE ALL ON FUNCTION public.invoke_whatsapp_instance_reaper() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invoke_whatsapp_instance_reaper() FROM anon;
REVOKE ALL ON FUNCTION public.invoke_whatsapp_instance_reaper() FROM authenticated;

-- Agendamento: 5 minutos, alinhado com os demais coletores de WhatsApp.
-- Exclusão de Instance não é operação sensível a latência — ninguém apaga uma
-- instância e fica olhando o painel do provider.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'whatsapp_instance_reaper') THEN
    PERFORM cron.unschedule('whatsapp_instance_reaper');
  END IF;

  PERFORM cron.schedule(
    'whatsapp_instance_reaper',
    '*/5 * * * *',
    $cron$SELECT public.invoke_whatsapp_instance_reaper()$cron$
  );
END;
$$;
