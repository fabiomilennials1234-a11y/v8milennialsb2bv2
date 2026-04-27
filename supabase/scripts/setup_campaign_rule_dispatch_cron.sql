-- Script: Configurar cron para campaign-rule-dispatch (regras de envio por etapa)
-- Execute no SQL Editor do Supabase após aplicar as migrations.
-- Substitua PROJECT_REF e CRON_SECRET pelos valores do seu projeto.
--
-- Como obter PROJECT_REF:
--   Supabase Dashboard → Project Settings → General → Reference ID
--
-- Como configurar CRON_SECRET:
--   Supabase Dashboard → Project Settings → Edge Functions → Secrets
--   Adicione CRON_SECRET com um valor aleatório (ex: openssl rand -hex 32)
--
-- Pré-requisitos:
--   1. Extensões pg_cron e pg_net habilitadas (Database → Extensions)
--   2. Migration 20260310000000_campaign_rule_dispatch_cron.sql aplicada
--

-- Inserir/atualizar configuração (substitua os valores)
INSERT INTO public.cron_config (key, value) VALUES
  (
    'campaign_rule_dispatch_url',
    'https://PROJECT_REF.supabase.co/functions/v1/campaign-rule-dispatch'
  ),
  (
    'cron_secret',
    'seu-cron-secret-aqui'
  )
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Verificar se as extensões estão habilitadas
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'AVISO: pg_cron não está habilitado. Habilite em Database → Extensions';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'AVISO: pg_net não está habilitado. Habilite em Database → Extensions';
  END IF;
END $$;

-- Verificar se a configuração foi aplicada
SELECT key, 
  CASE 
    WHEN key = 'cron_secret' THEN '***' 
    ELSE value 
  END as value 
FROM public.cron_config 
WHERE key IN ('campaign_rule_dispatch_url', 'cron_secret');
