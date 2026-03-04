-- =============================================================================
-- FIX: Garantir que pipe_rule_dispatch_url está configurada em cron_config
-- Sem esta URL, o pg_net trigger não consegue chamar a Edge Function
-- e os disparos ficam presos em 'scheduled' esperando o cron (se existir).
-- Date: 2026-03-04
-- =============================================================================

-- 1. Inserir/atualizar pipe_rule_dispatch_url
INSERT INTO public.cron_config (key, value)
VALUES ('pipe_rule_dispatch_url', 'https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/pipe-rule-dispatch')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- 2. Verificar que campaign_rule_dispatch_url também existe
INSERT INTO public.cron_config (key, value)
VALUES ('campaign_rule_dispatch_url', 'https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/campaign-rule-dispatch')
ON CONFLICT (key) DO NOTHING;

-- 3. Verificar que cron_secret existe (se não existir, criar um)
INSERT INTO public.cron_config (key, value)
VALUES ('cron_secret', 'pipe-dispatch-secret-' || gen_random_uuid()::text)
ON CONFLICT (key) DO NOTHING;

-- 4. Verificar pg_net está habilitado
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE '⚠️  pg_net NÃO está habilitado! Os disparos imediatos via trigger não funcionarão.';
    RAISE NOTICE '   Habilite em: Supabase Dashboard → Database → Extensions → pg_net';
  ELSE
    RAISE NOTICE '✅ pg_net está habilitado';
  END IF;
END $$;

-- 5. Verificar que o trigger existe nas tabelas pipe
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM information_schema.triggers
  WHERE trigger_name = 'trg_pipe_whatsapp_dispatch'
    AND event_object_table = 'pipe_whatsapp';

  IF v_count = 0 THEN
    RAISE NOTICE '⚠️  Trigger trg_pipe_whatsapp_dispatch NÃO existe! Recriando...';

    CREATE TRIGGER trg_pipe_whatsapp_dispatch
      AFTER INSERT OR UPDATE OF status ON public.pipe_whatsapp
      FOR EACH ROW
      EXECUTE FUNCTION public.trigger_pipe_dispatch_rules('whatsapp');

    RAISE NOTICE '✅ Trigger trg_pipe_whatsapp_dispatch recriado';
  ELSE
    RAISE NOTICE '✅ Trigger trg_pipe_whatsapp_dispatch existe';
  END IF;
END $$;

DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM information_schema.triggers
  WHERE trigger_name = 'trg_pipe_confirmacao_dispatch'
    AND event_object_table = 'pipe_confirmacao';

  IF v_count = 0 THEN
    CREATE TRIGGER trg_pipe_confirmacao_dispatch
      AFTER INSERT OR UPDATE OF status ON public.pipe_confirmacao
      FOR EACH ROW
      EXECUTE FUNCTION public.trigger_pipe_dispatch_rules('confirmacao');
    RAISE NOTICE '✅ Trigger trg_pipe_confirmacao_dispatch recriado';
  ELSE
    RAISE NOTICE '✅ Trigger trg_pipe_confirmacao_dispatch existe';
  END IF;
END $$;

DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM information_schema.triggers
  WHERE trigger_name = 'trg_pipe_propostas_dispatch'
    AND event_object_table = 'pipe_propostas';

  IF v_count = 0 THEN
    CREATE TRIGGER trg_pipe_propostas_dispatch
      AFTER INSERT OR UPDATE OF status ON public.pipe_propostas
      FOR EACH ROW
      EXECUTE FUNCTION public.trigger_pipe_dispatch_rules('propostas');
    RAISE NOTICE '✅ Trigger trg_pipe_propostas_dispatch recriado';
  ELSE
    RAISE NOTICE '✅ Trigger trg_pipe_propostas_dispatch existe';
  END IF;
END $$;

-- 6. Log final
DO $$
DECLARE
  v_url TEXT;
  v_secret TEXT;
BEGIN
  SELECT value INTO v_url FROM public.cron_config WHERE key = 'pipe_rule_dispatch_url';
  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';

  RAISE NOTICE '=== Configuração de Disparos ===';
  RAISE NOTICE 'pipe_rule_dispatch_url: %', v_url;
  RAISE NOTICE 'cron_secret configurado: %', CASE WHEN v_secret IS NOT NULL AND v_secret != '' THEN 'SIM' ELSE 'NÃO' END;
END $$;
