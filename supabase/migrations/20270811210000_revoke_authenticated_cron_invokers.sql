-- 20270811210000_revoke_authenticated_cron_invokers.sql
--
-- APLICADA EM PRODUÇÃO em 2026-08-11, autorizada pelo CTO. Fecha o acionamento do
-- MOTOR do produto por usuário logado.
--
-- 26 funções `invoke_*` mais a `sweep_copilot_queue` são SECURITY DEFINER, leem
-- `cron_config` (inclusive o `cron_secret`) e disparam as edge functions do
-- produto via `pg_net`. Todas estavam executáveis por `authenticated`, logo
-- servidas pelo PostgREST a qualquer sessão logada.
--
-- NÃO é cross-tenant. É AMPLIFICAÇÃO: cada chamada faz o banco disparar HTTP com
-- a credencial de cron, em nome do sistema. Um laço no console do navegador
-- aciona o worker do Copilot, o disparo de campanha, a fila de webhook ou o
-- replay de DLQ do WhatsApp — fora de hora e quantas vezes quiser. O incidente de
-- 06/08 (42 minutos sem gravar mensagem, pool esgotado) mostra o custo desse
-- caminho ser acionado demais; lá foi um backfill, aqui basta um `for`.
--
-- A PIOR É A `sweep_copilot_queue`, por dois motivos que o prefixo escondia:
--   1. RECEBE PARÂMETRO DO CHAMADOR — `p_lease_seconds`. O corpo trata como
--      abandonado todo batch com `claimed_at < now() - p_lease_seconds`. Com `0`,
--      TODO batch em voo vira abandonado e é redisparado com `force_drain=true`:
--      reprocessamento de conversa que está sendo processada AGORA, ou seja
--      MENSAGEM DUPLICADA saindo pelo WhatsApp do cliente — a classe que este
--      repositório conhece como vetor de ban.
--   2. É UM LAÇO — um `net.http_post` por `batch_key`. A amplificação não é 1; é o
--      número de batches na fila.
--
-- POR QUE NÃO QUEBRA NADA, medido antes de aplicar:
--   * ZERO chamadores no produto (grep por `rpc("invoke_…")` e
--     `rpc("sweep_copilot_queue")` em `src/` e `supabase/functions/`);
--   * ZERO chamadores internos `INVOKER` no banco;
--   * quem chama é o `pg_cron`, como `postgres`; dono e `service_role` mantêm
--     EXECUTE. Verificado depois: 0 chamáveis expostas, 32 com service_role e
--     postgres intactos.
--
-- AS 10 FUNÇÕES DE GATILHO QUE TAMBÉM DISPARAM HTTP FICAM DE FORA DE PROPÓSITO
-- (`notify_copilot_batch_processor`, `notify_support_staff_new_ticket`, os
-- `trigger_*`). O Postgres RECUSA chamada direta a função de gatilho, então o
-- grant é inerte: revogá-las não fecharia nada e daria falsa sensação de conserto.
-- Uma delas tem grant para `anon` e continua inofensiva pelo mesmo motivo.
--
-- NÃO CONSERTA a `sweep_copilot_queue`, apenas a contém. Enquanto
-- `p_lease_seconds` vier de fora sem piso, quem tiver `service_role` também pode
-- zerá-lo. O conserto é o piso NO CORPO (`GREATEST(p_lease_seconds, 60)`) e fica
-- como fatia própria.

REVOKE EXECUTE ON FUNCTION public.invoke_blast_plan_release() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invoke_calculate_portfolio_health() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invoke_campaign_rule_dispatch() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invoke_copilot_v2_worker() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invoke_cron_health_check() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invoke_followup_reclassify() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invoke_history_sync_worker() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invoke_mass_send_status() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invoke_meta_conversion_dispatch() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invoke_meta_leadgen_poll() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invoke_pipe_rule_dispatch() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invoke_process_ai_actions() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invoke_process_copilot_followups() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invoke_process_followup_automations() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invoke_process_followup_situations() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invoke_process_outbound_dispatches() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invoke_process_scheduled_user_messages() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invoke_process_webhook_deliveries() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invoke_process_workflow_executions() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invoke_refresh_meta_tokens() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invoke_retry_dead_letter_jobs() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invoke_whatsapp_dlq_replay() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invoke_whatsapp_health_monitor() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invoke_whatsapp_media_retry() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invoke_whatsapp_session_watchdog() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invoke_workflow_cron_triggers() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sweep_copilot_queue(integer) FROM PUBLIC, anon, authenticated;
