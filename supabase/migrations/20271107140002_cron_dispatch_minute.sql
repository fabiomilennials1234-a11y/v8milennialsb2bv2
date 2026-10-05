-- 20271107140002_cron_dispatch_minute.sql
--
-- ⚠️ VERSÃO PROVISÓRIA. Renumerar acima do topo real do ledger de prod na hora
-- de aplicar. Aplicação em prod é do CTO. Ordem: M1 → M2 → 24 h → M3 (esta).
-- Rollback pareado: supabase/migrations/rollback/<este arquivo>.
--
-- Contexto (OOM de prod em 2026-10-05): com cron.use_background_workers = off,
-- cada job do pg_cron abre uma CONEXÃO nova. 19 jobs de minuto (17 no mesmo
-- segundo :00) davam ~1.020 conexões/h e ~700 ms médios por run (vs ~46 ms dos
-- jobs 100/107 sozinhos em minuto ímpar); às 15:04 houve `job startup timeout`
-- com 17 jobs travados ~35 s. Os gates do #2162 já evitam a chamada HTTP com
-- fila vazia — o custo que sobrou é o próprio disparo.
--
-- O que muda: UM job `cron-dispatch-minute` (* * * * *) chama
-- public.cron_dispatch_minute(), que executa em sequência o que os 19 jobs
-- faziam. ~1.020 → 60 conexões/h. Os 19 jobs NÃO são apagados: ficam
-- `active = false` (casados por jobname, nunca por jobid), e o rollback só os
-- reativa.
--
-- Contrato do dispatcher:
--   • cada subtarefa num bloco BEGIN … EXCEPTION próprio: uma falha vira
--     RAISE WARNING, não derruba as outras nem desfaz os net.http_post já
--     enfileirados (o savepoint só desfaz a própria subtarefa);
--   • lock_timeout 2 s (na definição da função, vale para as subtarefas): um
--     UPDATE de voip_calls preso em lock não segura o minuto inteiro;
--   • sem statement_timeout (decisão do plano: os invocadores só enfileiram);
--   • ordem: varreduras/recuperação (voip 139, 96; sweep do copilot 85) antes
--     das filas;
--   • cadência original preservada pela paridade do minuto UTC de p_now:
--     par → mass-send-status-poll (45) e whatsapp_media_retry (51), que eram
--     */2; ímpar → infra-watchdog (100) e billing-provision-worker (107), que
--     eram 1-59/2; minuto 7 → purge_rate_limits() (M1), 1×/h. p_now existe
--     só para teste; o job chama sem argumento.
--   • nenhum índice novo (gates existentes < 0,5 ms; 59 ≈ 3,8 ms medido).
--
-- Observabilidade (ADR-0038, falha sustentada): antes, sweep_copilot_queue,
-- omie, blast e os UPDATEs de voip falhavam o PRÓPRIO job e o
-- check_cron_job_health alertava. Dentro do dispatcher a falha é engolida
-- pelo bloco — sem compensação, o alerta sumiria. Por isso:
--   • public.cron_dispatch_falhas (UNLOGGED, RLS sem policy) guarda a
--     sequência de falhas por subtarefa;
--   • 3 execuções seguidas falhando → system_alerts 'cron_job_failure'
--     critical com job_name 'cron-dispatch-minute/<subtarefa>' (um aberto por
--     subtarefa);
--   • primeira execução bem-sucedida → zera e resolve o alerta
--     (resolved_reason 'auto_recovered').
--   Caminho feliz: um EXISTS numa tabela vazia por minuto.
-- O stale do check_cron_job_health (job 39) passa a vigiar o dispatcher sem
-- mudança: ele olha `cron.job WHERE active AND schedule IN ('* * * * *', …)`.
-- Alertas cron_job_stale/cron_job_failure abertos com os nomes antigos são
-- resolvidos aqui (resolved_reason 'consolidated_into_cron_dispatch_minute');
-- sem isso nunca fechariam, porque o job inativo não roda mais.

BEGIN;

CREATE UNLOGGED TABLE IF NOT EXISTS public.cron_dispatch_falhas (
  subtarefa        text PRIMARY KEY,
  falhas_seguidas  integer NOT NULL,
  primeira_falha   timestamptz NOT NULL,
  ultima_falha     timestamptz NOT NULL,
  ultima_mensagem  text
);
COMMENT ON TABLE public.cron_dispatch_falhas IS
  'Estado de falha por subtarefa do cron_dispatch_minute (sustentada >= 3 → system_alerts). Plataforma, sem organization_id; só o owner escreve.';
ALTER TABLE public.cron_dispatch_falhas ENABLE ROW LEVEL SECURITY;
-- service_role entra no REVOKE: o default ACL do schema public dá arwdDxtm a
-- ele, e service_role tem BYPASSRLS — RLS sozinha não o impede de escrever.
REVOKE ALL ON TABLE public.cron_dispatch_falhas FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.cron_dispatch_falhas TO service_role;

CREATE OR REPLACE FUNCTION public.cron_dispatch_registrar_saude(p_ok text[], p_falhas jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_falha record;
  v_n     integer;
BEGIN
  -- Recuperou: zera e resolve. O EXISTS protege o caminho feliz de qualquer
  -- varredura de system_alerts.
  IF EXISTS (SELECT 1 FROM public.cron_dispatch_falhas WHERE subtarefa = ANY (p_ok)) THEN
    WITH zeradas AS (
      DELETE FROM public.cron_dispatch_falhas WHERE subtarefa = ANY (p_ok) RETURNING subtarefa
    )
    UPDATE public.system_alerts a
       SET resolved_at = now(),
           metadata    = a.metadata || jsonb_build_object('resolved_reason', 'auto_recovered')
      FROM zeradas z
     WHERE a.category = 'cron_job_failure'
       AND a.resolved_at IS NULL
       AND a.metadata->>'job_name' = 'cron-dispatch-minute/' || z.subtarefa;
  END IF;

  FOR v_falha IN
    SELECT x.sub, x.erro FROM jsonb_to_recordset(COALESCE(p_falhas, '[]'::jsonb)) AS x(sub text, erro text)
  LOOP
    INSERT INTO public.cron_dispatch_falhas AS f
      (subtarefa, falhas_seguidas, primeira_falha, ultima_falha, ultima_mensagem)
    VALUES (v_falha.sub, 1, now(), now(), v_falha.erro)
    ON CONFLICT (subtarefa) DO UPDATE
      SET falhas_seguidas = f.falhas_seguidas + 1,
          ultima_falha    = now(),
          ultima_mensagem = EXCLUDED.ultima_mensagem
    RETURNING f.falhas_seguidas INTO v_n;

    CONTINUE WHEN v_n < 3;
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.system_alerts
       WHERE category = 'cron_job_failure'
         AND resolved_at IS NULL
         AND metadata->>'job_name' = 'cron-dispatch-minute/' || v_falha.sub
    );

    INSERT INTO public.system_alerts (organization_id, severity, category, title, message, metadata)
    VALUES (
      NULL,
      'critical',
      'cron_job_failure',
      'Cron job falhando: cron-dispatch-minute/' || v_falha.sub,
      v_n || ' execuções seguidas falharam.' || COALESCE(E'\nMensagem: ' || v_falha.erro, ''),
      jsonb_build_object(
        'job_name',             'cron-dispatch-minute/' || v_falha.sub,
        'consecutive_failures', v_n,
        'last_message',         v_falha.erro,
        'last_failure_at',      now(),
        'rule',                 'cron-dispatch-sustentada'
      )
    );
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.cron_dispatch_registrar_saude(text[], jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cron_dispatch_minute(p_now timestamptz DEFAULT now())
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '2s'
AS $function$
DECLARE
  v_minuto integer := extract(minute FROM p_now AT TIME ZONE 'UTC')::integer;
  v_ok     text[]  := '{}';
  v_falhas jsonb   := '[]';
BEGIN
  -- ── Varredura / recuperação ──────────────────────────────────────────────
  BEGIN -- job 139
    UPDATE public.voip_calls
       SET status = 'expired',
           end_reason = 'reservation_expired',
           ended_at = now(),
           updated_at = now()
     WHERE status = 'authorized'
       AND authorized_at < now() - interval '12 seconds';
    v_ok := v_ok || 'voip-reap-authorized'::text;
  EXCEPTION WHEN OTHERS THEN
    v_falhas := v_falhas || jsonb_build_object('sub', 'voip-reap-authorized', 'erro', SQLSTATE || ' ' || SQLERRM);
    RAISE WARNING '[cron-dispatch-minute] voip-reap-authorized: % %', SQLSTATE, SQLERRM;
  END;

  BEGIN -- job 96
    UPDATE public.voip_calls
       SET status = 'ended',
           end_reason = 'no_terminal_event',
           ended_at = now(),
           updated_at = now()
     WHERE (
             status = 'ringing'
             AND COALESCE(ringing_at, authorized_at) < now() - interval '2 minutes'
           )
        OR (
             status = 'connected'
             AND COALESCE(connected_at, ringing_at, authorized_at) < now() - interval '2 hours'
           );
    v_ok := v_ok || 'voip-sweep-stuck-calls'::text;
  EXCEPTION WHEN OTHERS THEN
    v_falhas := v_falhas || jsonb_build_object('sub', 'voip-sweep-stuck-calls', 'erro', SQLSTATE || ' ' || SQLERRM);
    RAISE WARNING '[cron-dispatch-minute] voip-sweep-stuck-calls: % %', SQLSTATE, SQLERRM;
  END;

  BEGIN -- job 85
    PERFORM public.sweep_copilot_queue();
    v_ok := v_ok || 'copilot-queue-sweep'::text;
  EXCEPTION WHEN OTHERS THEN
    v_falhas := v_falhas || jsonb_build_object('sub', 'copilot-queue-sweep', 'erro', SQLSTATE || ' ' || SQLERRM);
    RAISE WARNING '[cron-dispatch-minute] copilot-queue-sweep: % %', SQLSTATE, SQLERRM;
  END;

  -- ── Filas: todo minuto ───────────────────────────────────────────────────
  BEGIN -- job 54
    PERFORM public.invoke_copilot_v2_worker();
    v_ok := v_ok || 'copilot_v2_worker'::text;
  EXCEPTION WHEN OTHERS THEN
    v_falhas := v_falhas || jsonb_build_object('sub', 'copilot_v2_worker', 'erro', SQLSTATE || ' ' || SQLERRM);
    RAISE WARNING '[cron-dispatch-minute] copilot_v2_worker: % %', SQLSTATE, SQLERRM;
  END;

  BEGIN -- job 58
    PERFORM public.invoke_process_ai_actions();
    v_ok := v_ok || 'process-ai-actions'::text;
  EXCEPTION WHEN OTHERS THEN
    v_falhas := v_falhas || jsonb_build_object('sub', 'process-ai-actions', 'erro', SQLSTATE || ' ' || SQLERRM);
    RAISE WARNING '[cron-dispatch-minute] process-ai-actions: % %', SQLSTATE, SQLERRM;
  END;

  BEGIN -- job 59
    PERFORM public.invoke_process_workflow_executions();
    v_ok := v_ok || 'process-workflow-executions'::text;
  EXCEPTION WHEN OTHERS THEN
    v_falhas := v_falhas || jsonb_build_object('sub', 'process-workflow-executions', 'erro', SQLSTATE || ' ' || SQLERRM);
    RAISE WARNING '[cron-dispatch-minute] process-workflow-executions: % %', SQLSTATE, SQLERRM;
  END;

  BEGIN -- job 60 (varredura temporal; sem gate de fila de propósito)
    PERFORM public.invoke_workflow_cron_triggers();
    v_ok := v_ok || 'workflow-cron-triggers'::text;
  EXCEPTION WHEN OTHERS THEN
    v_falhas := v_falhas || jsonb_build_object('sub', 'workflow-cron-triggers', 'erro', SQLSTATE || ' ' || SQLERRM);
    RAISE WARNING '[cron-dispatch-minute] workflow-cron-triggers: % %', SQLSTATE, SQLERRM;
  END;

  BEGIN -- job 61
    PERFORM public.invoke_campaign_rule_dispatch();
    v_ok := v_ok || 'campaign-rule-dispatch'::text;
  EXCEPTION WHEN OTHERS THEN
    v_falhas := v_falhas || jsonb_build_object('sub', 'campaign-rule-dispatch', 'erro', SQLSTATE || ' ' || SQLERRM);
    RAISE WARNING '[cron-dispatch-minute] campaign-rule-dispatch: % %', SQLSTATE, SQLERRM;
  END;

  BEGIN -- job 62
    PERFORM public.invoke_pipe_rule_dispatch();
    v_ok := v_ok || 'pipe-rule-dispatch'::text;
  EXCEPTION WHEN OTHERS THEN
    v_falhas := v_falhas || jsonb_build_object('sub', 'pipe-rule-dispatch', 'erro', SQLSTATE || ' ' || SQLERRM);
    RAISE WARNING '[cron-dispatch-minute] pipe-rule-dispatch: % %', SQLSTATE, SQLERRM;
  END;

  BEGIN -- job 63
    PERFORM public.invoke_process_scheduled_user_messages();
    v_ok := v_ok || 'process-scheduled-user-messages'::text;
  EXCEPTION WHEN OTHERS THEN
    v_falhas := v_falhas || jsonb_build_object('sub', 'process-scheduled-user-messages', 'erro', SQLSTATE || ' ' || SQLERRM);
    RAISE WARNING '[cron-dispatch-minute] process-scheduled-user-messages: % %', SQLSTATE, SQLERRM;
  END;

  BEGIN -- job 64
    PERFORM public.invoke_history_sync_worker();
    v_ok := v_ok || 'history-sync-worker'::text;
  EXCEPTION WHEN OTHERS THEN
    v_falhas := v_falhas || jsonb_build_object('sub', 'history-sync-worker', 'erro', SQLSTATE || ' ' || SQLERRM);
    RAISE WARNING '[cron-dispatch-minute] history-sync-worker: % %', SQLSTATE, SQLERRM;
  END;

  BEGIN -- job 93
    PERFORM public.invoke_omie_sync_dispatch();
    v_ok := v_ok || 'omie-sync-dispatch'::text;
  EXCEPTION WHEN OTHERS THEN
    v_falhas := v_falhas || jsonb_build_object('sub', 'omie-sync-dispatch', 'erro', SQLSTATE || ' ' || SQLERRM);
    RAISE WARNING '[cron-dispatch-minute] omie-sync-dispatch: % %', SQLSTATE, SQLERRM;
  END;

  BEGIN -- job 146
    PERFORM public.invoke_process_blast_recipients();
    v_ok := v_ok || 'process-blast-recipients'::text;
  EXCEPTION WHEN OTHERS THEN
    v_falhas := v_falhas || jsonb_build_object('sub', 'process-blast-recipients', 'erro', SQLSTATE || ' ' || SQLERRM);
    RAISE WARNING '[cron-dispatch-minute] process-blast-recipients: % %', SQLSTATE, SQLERRM;
  END;

  BEGIN -- job 153
    PERFORM public.invoke_send_push();
    v_ok := v_ok || 'send-push'::text;
  EXCEPTION WHEN OTHERS THEN
    v_falhas := v_falhas || jsonb_build_object('sub', 'send-push', 'erro', SQLSTATE || ' ' || SQLERRM);
    RAISE WARNING '[cron-dispatch-minute] send-push: % %', SQLSTATE, SQLERRM;
  END;

  BEGIN -- job 156
    PERFORM public.invoke_oraculo_feedback_worker('alerts');
    v_ok := v_ok || 'oraculo-feedback-alerts'::text;
  EXCEPTION WHEN OTHERS THEN
    v_falhas := v_falhas || jsonb_build_object('sub', 'oraculo-feedback-alerts', 'erro', SQLSTATE || ' ' || SQLERRM);
    RAISE WARNING '[cron-dispatch-minute] oraculo-feedback-alerts: % %', SQLSTATE, SQLERRM;
  END;

  -- ── Minuto par: eram */2 ──────────────────────────────────────────────────
  IF v_minuto % 2 = 0 THEN
    BEGIN -- job 45
      PERFORM public.invoke_mass_send_status();
      v_ok := v_ok || 'mass-send-status-poll'::text;
    EXCEPTION WHEN OTHERS THEN
      v_falhas := v_falhas || jsonb_build_object('sub', 'mass-send-status-poll', 'erro', SQLSTATE || ' ' || SQLERRM);
      RAISE WARNING '[cron-dispatch-minute] mass-send-status-poll: % %', SQLSTATE, SQLERRM;
    END;

    BEGIN -- job 51
      PERFORM public.invoke_whatsapp_media_retry();
      v_ok := v_ok || 'whatsapp_media_retry'::text;
    EXCEPTION WHEN OTHERS THEN
      v_falhas := v_falhas || jsonb_build_object('sub', 'whatsapp_media_retry', 'erro', SQLSTATE || ' ' || SQLERRM);
      RAISE WARNING '[cron-dispatch-minute] whatsapp_media_retry: % %', SQLSTATE, SQLERRM;
    END;

  -- ── Minuto ímpar: eram 1-59/2 ─────────────────────────────────────────────
  ELSE
    BEGIN -- job 100
      PERFORM public.invoke_infra_watchdog();
      v_ok := v_ok || 'infra-watchdog'::text;
    EXCEPTION WHEN OTHERS THEN
      v_falhas := v_falhas || jsonb_build_object('sub', 'infra-watchdog', 'erro', SQLSTATE || ' ' || SQLERRM);
      RAISE WARNING '[cron-dispatch-minute] infra-watchdog: % %', SQLSTATE, SQLERRM;
    END;

    BEGIN -- job 107 (pagamento)
      PERFORM public.invoke_billing_provision_worker();
      v_ok := v_ok || 'billing-provision-worker'::text;
    EXCEPTION WHEN OTHERS THEN
      v_falhas := v_falhas || jsonb_build_object('sub', 'billing-provision-worker', 'erro', SQLSTATE || ' ' || SQLERRM);
      RAISE WARNING '[cron-dispatch-minute] billing-provision-worker: % %', SQLSTATE, SQLERRM;
    END;
  END IF;

  -- ── Minuto 7: purga horária de rate_limits (M1) ──────────────────────────
  IF v_minuto = 7 THEN
    BEGIN
      PERFORM public.purge_rate_limits();
      v_ok := v_ok || 'rate-limits-purge'::text;
    EXCEPTION WHEN OTHERS THEN
      v_falhas := v_falhas || jsonb_build_object('sub', 'rate-limits-purge', 'erro', SQLSTATE || ' ' || SQLERRM);
      RAISE WARNING '[cron-dispatch-minute] rate-limits-purge: % %', SQLSTATE, SQLERRM;
    END;
  END IF;

  -- ── Saúde: falha sustentada vira alerta; recuperação resolve ─────────────
  BEGIN
    PERFORM public.cron_dispatch_registrar_saude(v_ok, v_falhas);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[cron-dispatch-minute] registrar_saude: % %', SQLSTATE, SQLERRM;
  END;
END;
$function$;

-- ACL igual à dos invoke_*: postgres (owner, pg_cron) + service_role.
REVOKE ALL ON FUNCTION public.cron_dispatch_minute(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_dispatch_minute(timestamptz) TO service_role;

-- ── Agenda: um job novo, 19 antigos desativados por jobname ────────────────
DO $$
DECLARE
  v_antigos text[] := ARRAY[
    'voip-reap-authorized', 'voip-sweep-stuck-calls', 'copilot-queue-sweep',
    'copilot_v2_worker', 'process-ai-actions', 'process-workflow-executions',
    'workflow-cron-triggers', 'campaign-rule-dispatch', 'pipe-rule-dispatch',
    'process-scheduled-user-messages', 'history-sync-worker', 'omie-sync-dispatch',
    'process-blast-recipients', 'send-push', 'oraculo-feedback-alerts',
    'mass-send-status-poll', 'whatsapp_media_retry',
    'infra-watchdog', 'billing-provision-worker'
  ];
  v_nome text;
  v_job  record;
  v_achou boolean;
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE NOTICE 'pg_cron ausente — cron-dispatch-minute não agendado';
    RETURN;
  END IF;

  -- Idempotente: cron.schedule com nome existente atualiza o job.
  PERFORM cron.schedule('cron-dispatch-minute', '* * * * *', 'SELECT public.cron_dispatch_minute()');

  FOREACH v_nome IN ARRAY v_antigos LOOP
    v_achou := false;
    FOR v_job IN SELECT jobid, active FROM cron.job WHERE jobname = v_nome LOOP
      v_achou := true;
      IF v_job.active THEN
        PERFORM cron.alter_job(job_id := v_job.jobid, active := false);
      END IF;
    END LOOP;
    IF NOT v_achou THEN
      RAISE NOTICE 'job % ausente — nada a desativar', v_nome;
    END IF;
  END LOOP;

  UPDATE public.system_alerts
     SET resolved_at = now(),
         metadata    = metadata || jsonb_build_object('resolved_reason', 'consolidated_into_cron_dispatch_minute')
   WHERE category IN ('cron_job_stale', 'cron_job_failure')
     AND resolved_at IS NULL
     AND metadata->>'job_name' = ANY (v_antigos);
END;
$$;

COMMIT;
