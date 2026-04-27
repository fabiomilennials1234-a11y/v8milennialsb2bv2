-- Verificação: Disparo imediato de campanhas via pg_net
-- Execute no SQL Editor do Supabase (Database → SQL Editor).
-- Este script verifica se o disparo automático está corretamente configurado.

-- ============================================
-- 1. Verificar extensões pg_net e pg_cron
-- ============================================
SELECT extname, extversion
FROM pg_extension
WHERE extname IN ('pg_net', 'pg_cron')
ORDER BY extname;
-- Esperado: 2 linhas (pg_cron e pg_net)

-- ============================================
-- 2. Verificar cron_config (URL e secret)
-- ============================================
SELECT key,
  CASE
    WHEN key = 'cron_secret' THEN LEFT(value, 4) || '****'
    ELSE value
  END as value,
  CASE
    WHEN key = 'campaign_rule_dispatch_url' AND (value IS NULL OR value = '' OR value LIKE '%PROJECT_REF%') THEN '❌ URL NÃO CONFIGURADA - substitua PROJECT_REF pela sua referência do projeto'
    WHEN key = 'campaign_rule_dispatch_url' THEN '✅ OK'
    WHEN key = 'cron_secret' AND (value IS NULL OR value = '' OR value = 'seu-cron-secret-aqui') THEN '❌ SECRET NÃO CONFIGURADO'
    WHEN key = 'cron_secret' THEN '✅ OK'
    ELSE '?'
  END as status
FROM public.cron_config
WHERE key IN ('campaign_rule_dispatch_url', 'cron_secret');
-- Esperado: 2 linhas com status ✅ OK

-- ============================================
-- 3. Verificar trigger existe e é a versão atualizada (com pg_net)
-- ============================================
SELECT tgname, tgtype, tgenabled
FROM pg_trigger
WHERE tgname = 'trg_campanha_leads_dispatch_rules';
-- Esperado: 1 linha

-- Verificar se a função do trigger contém pg_net (versão atualizada)
SELECT
  CASE
    WHEN prosrc LIKE '%net.http_post%' THEN '✅ Trigger ATUALIZADO com pg_net (disparo imediato)'
    ELSE '❌ Trigger ANTIGO sem pg_net - aplique migration 20260317000000'
  END as trigger_version
FROM pg_proc
WHERE proname = 'trigger_campanha_leads_dispatch_rules';

-- ============================================
-- 4. Verificar pg_cron job (fallback para mensagens com delay)
-- ============================================
SELECT jobid, schedule, command, nodename
FROM cron.job
WHERE jobname = 'campaign-rule-dispatch';
-- Esperado: 1 linha com schedule = '* * * * *'

-- ============================================
-- 5. Verificar mensagens pendentes na fila
-- ============================================
SELECT status, COUNT(*) as total
FROM public.scheduled_campaign_messages
GROUP BY status
ORDER BY status;
-- scheduled = mensagens aguardando processamento
-- sent = mensagens enviadas com sucesso
-- failed = mensagens com erro

-- ============================================
-- 6. Teste rápido de pg_net (opcional)
-- Descomente para testar se pg_net consegue fazer HTTP POST
-- ============================================
-- SELECT net.http_post(
--   url := (SELECT value FROM public.cron_config WHERE key = 'campaign_rule_dispatch_url'),
--   headers := jsonb_build_object(
--     'Content-Type', 'application/json',
--     'x-cron-secret', (SELECT value FROM public.cron_config WHERE key = 'cron_secret')
--   ),
--   body := '{}'::jsonb
-- );
-- Se retornar um ID numérico, pg_net está funcionando
