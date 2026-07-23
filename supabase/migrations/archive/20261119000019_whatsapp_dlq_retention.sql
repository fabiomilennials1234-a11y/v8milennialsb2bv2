-- 20261119000019_whatsapp_dlq_retention.sql
--
-- Fix #6 (DLQ que nunca dreena). Aplicado em prod (jsjsm) 2026-06-09.
--
-- Diagnóstico: whatsapp_webhook_dlq tinha ~40k linhas (113MB), todas resolved_at
-- NULL — "nunca resolve". Causa: 99% (40k) eram eventos de instâncias Uazapi cujo
-- token NÃO está em whatsapp_instance_secrets (instâncias deletadas/deregistradas
-- do CRM mas ainda ativas no Uazapi mandando webhook). Irrecuperáveis (sem secret
-- = sem org destino). Replay tenta 5x e desiste. 2 instâncias ativas dominam:
-- tokens 31629c98-... (34k, ativo) e 3b8b416b-... (2.6k, ativo).
--   → AÇÃO OPS (fora desta migration): desregistrar essas instâncias no Uazapi
--     (ou re-registrar no CRM) p/ estancar a fonte. Ver debug-whatsapp how-to.
--
-- Os ~163 com token registrado (recuperáveis) foram MANTIDOS p/ follow-up
-- (provável secret órfão: instância deletada, secret sobrou → resolveInstanceByToken
-- acha o secret mas o whatsapp_instances já não existe → null → DLQ). ~78/dia.
--
-- One-time: purge dos irrecuperáveis + VACUUM FULL (113MB→464kB) feito operacional.
-- Durável: retenção diária (resolved + unresolved >14d). O DELETE antigo (job de
-- retenção) só apagava resolved_at IS NOT NULL = sempre 0 → por isso crescia.

SELECT cron.schedule('whatsapp-dlq-retention', '43 3 * * *',
  $$DELETE FROM public.whatsapp_webhook_dlq
    WHERE resolved_at IS NOT NULL
       OR (resolved_at IS NULL AND created_at < now() - interval '14 days')$$);
