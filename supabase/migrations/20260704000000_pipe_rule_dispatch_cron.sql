-- Migration: pg_cron para pipe-rule-dispatch (regras de envio por etapa para funis)
-- Corrige: disparos configurados em funis (pipe_whatsapp, pipe_confirmacao, pipe_propostas)
-- não estavam sendo executados porque faltava:
--   1. pipe_rule_dispatch_url em cron_config (pg_net não conseguia chamar a Edge Function)
--   2. Job pg_cron para processar a fila periodicamente (fallback do pg_net)
--   3. Função invoke_pipe_rule_dispatch() equivalente à de campanhas
--
-- Requer extensões pg_cron e pg_net (mesmas de campaign-rule-dispatch).
-- Para ativar: insira em cron_config a URL da Edge Function:
--   INSERT INTO public.cron_config (key, value) VALUES
--     ('pipe_rule_dispatch_url', 'https://PROJECT_REF.supabase.co/functions/v1/pipe-rule-dispatch')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
-- Date: 2026-07-04

-- ============================================
-- 1. FUNÇÃO invoke_pipe_rule_dispatch (equivalente à de campanhas)
-- ============================================

CREATE OR REPLACE FUNCTION public.invoke_pipe_rule_dispatch()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  worker_url TEXT;
  secret_val TEXT;
BEGIN
  SELECT value INTO worker_url FROM public.cron_config WHERE key = 'pipe_rule_dispatch_url';
  SELECT value INTO secret_val FROM public.cron_config WHERE key = 'cron_secret';
  IF worker_url IS NULL OR worker_url = '' THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := worker_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', COALESCE(secret_val, '')
    ),
    body := '{}'::jsonb
  );
EXCEPTION
  WHEN undefined_function THEN
    NULL;
  WHEN OTHERS THEN
    NULL;
END;
$$;

COMMENT ON FUNCTION public.invoke_pipe_rule_dispatch IS 'Chama a Edge Function pipe-rule-dispatch via pg_net. Configure pipe_rule_dispatch_url e cron_secret em cron_config.';

-- ============================================
-- 2. AGENDAR JOB pg_cron (a cada minuto, igual campanhas)
-- ============================================

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Remove job anterior se existir (idempotente)
    BEGIN
      PERFORM cron.unschedule('pipe-rule-dispatch');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    PERFORM cron.schedule(
      'pipe-rule-dispatch',
      '* * * * *',
      'SELECT public.invoke_pipe_rule_dispatch()'
    );
    RAISE NOTICE '✅ Job pg_cron "pipe-rule-dispatch" agendado (a cada minuto)';
  ELSE
    RAISE NOTICE '⚠️  pg_cron não está habilitado. Job pipe-rule-dispatch NÃO foi criado.';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE '⚠️  Erro ao agendar job pipe-rule-dispatch: %', SQLERRM;
END
$outer$;

-- ============================================
-- 3. INSERIR pipe_rule_dispatch_url EM cron_config
-- ============================================
-- Deriva automaticamente da campaign_rule_dispatch_url existente
-- (substitui "campaign-rule-dispatch" por "pipe-rule-dispatch")

DO $$
DECLARE
  v_campaign_url TEXT;
  v_pipe_url TEXT;
BEGIN
  -- Tenta derivar da URL de campaign
  SELECT value INTO v_campaign_url
  FROM public.cron_config
  WHERE key = 'campaign_rule_dispatch_url';

  IF v_campaign_url IS NOT NULL AND v_campaign_url != '' THEN
    v_pipe_url := replace(v_campaign_url, 'campaign-rule-dispatch', 'pipe-rule-dispatch');

    INSERT INTO public.cron_config (key, value)
    VALUES ('pipe_rule_dispatch_url', v_pipe_url)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

    RAISE NOTICE '✅ pipe_rule_dispatch_url configurado automaticamente: %', v_pipe_url;
  ELSE
    RAISE NOTICE '⚠️  campaign_rule_dispatch_url não encontrado em cron_config. Configure pipe_rule_dispatch_url manualmente.';
  END IF;
END $$;

-- ============================================
-- 4. RESET: Mensagens stuck em 'processing' (limpeza)
-- ============================================
-- Se houver mensagens travadas em 'processing' de execuções anteriores, resetar.

UPDATE public.scheduled_pipe_messages
SET status = 'scheduled', scheduled_at = now()
WHERE status = 'processing';

-- ============================================
-- 5. VERIFICAÇÃO FINAL
-- ============================================

DO $$
DECLARE
  v_has_pg_cron BOOLEAN;
  v_has_pg_net BOOLEAN;
  v_pipe_url TEXT;
  v_secret TEXT;
  v_job_count INT;
  v_pending_count INT;
BEGIN
  SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') INTO v_has_pg_cron;
  SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_net') INTO v_has_pg_net;

  IF NOT v_has_pg_cron THEN
    RAISE NOTICE '⚠️  pg_cron NÃO está habilitado. Habilite em: Supabase Dashboard → Database → Extensions';
  ELSE
    RAISE NOTICE '✅ pg_cron está habilitado';
  END IF;

  IF NOT v_has_pg_net THEN
    RAISE NOTICE '⚠️  pg_net NÃO está habilitado. Habilite em: Supabase Dashboard → Database → Extensions';
  ELSE
    RAISE NOTICE '✅ pg_net está habilitado';
  END IF;

  -- Verificar cron_config
  BEGIN
    SELECT value INTO v_pipe_url FROM public.cron_config WHERE key = 'pipe_rule_dispatch_url';
    SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';

    IF v_pipe_url IS NULL OR v_pipe_url = '' THEN
      RAISE NOTICE '⚠️  pipe_rule_dispatch_url NÃO CONFIGURADO em cron_config';
    ELSE
      RAISE NOTICE '✅ pipe_rule_dispatch_url configurado: %', v_pipe_url;
    END IF;

    IF v_secret IS NULL OR v_secret = '' OR v_secret = 'seu-cron-secret-aqui' THEN
      RAISE NOTICE '⚠️  cron_secret NÃO CONFIGURADO em cron_config';
    ELSE
      RAISE NOTICE '✅ cron_secret configurado';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '⚠️  Tabela cron_config não encontrada';
  END;

  -- Verificar pg_cron job
  IF v_has_pg_cron THEN
    BEGIN
      SELECT COUNT(*) INTO v_job_count FROM cron.job WHERE jobname = 'pipe-rule-dispatch';
      IF v_job_count = 0 THEN
        RAISE NOTICE '⚠️  Job pg_cron "pipe-rule-dispatch" NÃO encontrado';
      ELSE
        RAISE NOTICE '✅ Job pg_cron "pipe-rule-dispatch" ativo';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '⚠️  Não foi possível verificar jobs do pg_cron';
    END;
  END IF;

  -- Contar mensagens pendentes
  BEGIN
    SELECT COUNT(*) INTO v_pending_count
    FROM public.scheduled_pipe_messages
    WHERE status = 'scheduled';

    IF v_pending_count > 0 THEN
      RAISE NOTICE '📬 % mensagens pendentes na fila scheduled_pipe_messages (serão processadas pelo próximo ciclo)', v_pending_count;
    ELSE
      RAISE NOTICE '📭 Nenhuma mensagem pendente na fila scheduled_pipe_messages';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RAISE NOTICE '--- Resumo da fila scheduled_pipe_messages ---';
END $$;

-- Mostrar contagem por status
SELECT status, COUNT(*) as total
FROM public.scheduled_pipe_messages
GROUP BY status
ORDER BY status;
