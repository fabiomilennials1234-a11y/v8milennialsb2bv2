-- 20271107140001_cron_gate_workflow_billing.sql
--
-- ⚠️ VERSÃO PROVISÓRIA. Renumerar acima do topo real do ledger de prod na hora
-- de aplicar. Aplicação em prod é do CTO. Ordem: M1 → M2 (esta) → 24 h → M3.
-- Rollback pareado: supabase/migrations/rollback/<este arquivo>.
--
-- Os dois invocadores de minuto que sobraram SEM gate depois do #2162
-- (20271021000026/31): job 59 (process-workflow-executions, 60 chamadas/h,
-- ~150 edge calls/h às 11–12 h UTC) e job 107 (billing-provision-worker,
-- 25 chamadas/h com as três tabelas vazias). Mesmo padrão do #2162: EXISTS
-- só-leitura antes do net.http_post; claim e reavaliação continuam no worker.
-- O gate é SUPERCONJUNTO do que o worker faria: errar = disparar a mais, nunca
-- perder trabalho. Trabalho enfileirado depois de um gate negativo espera o
-- próximo tick, como já acontece nos outros invocadores.
--
-- Corpos de prod capturados (pg_get_functiondef) em 2026-10-05 — o rollback
-- volta exatamente a eles. Assinatura, owner, SECURITY DEFINER, search_path e
-- grants preservados (CREATE OR REPLACE; ACL postgres + service_role).
--
-- Gate 59 = união das 4 tarefas do modo default
-- (supabase/functions/process-workflow-executions/index.ts, modo default):
--   (i)   claim_workflow_executions: running vencido ∪ processing > 10 min ∪
--         waiting_response vencido (predicado copiado da RPC; usa
--         idx_workflow_executions_claim, 2,9 ms medido);
--   (ii)  claim_workflow_button_queue: pergunta 'queued' com execução 'paused'
--         no mesmo nó (a RPC exige isso para reivindicar);
--   (iii) claim_workflow_button_send_checks: 'sending'/'uncertain' com
--         send_check_count < 12, enviada há ≥ 2 min, check vencido, execução
--         'paused' no mesmo nó;
--   (iv)  reconcile_workflow_button_questions: 'waiting' com prazo vencido OU
--         com qualquer ingress recebido antes do prazo (superconjunto do filtro
--         kind/quoted/option da RPC), execução 'paused'.
-- Efeito colateral conhecido, benigno: o controlador do pool
-- (_shared/workflow-dispatch-pool.ts) conta idleStreak por INVOCAÇÃO. Sem tick
-- ocioso, o pool só encolhe depois de 20 execuções reais ociosas, não 20
-- minutos. Teto: workflow_pool_max (padrão 16, cron_config). Subida não muda:
-- invocação saturada deixa trabalho vencido, o gate segue verdadeiro e os
-- ticks continuam a cada minuto.
--
-- Gate 107 (área de PAGAMENTO) = anti-join fiel a
-- supabase/functions/billing-provision-worker/index.ts: pendente é
--   • org_subscriptions com provider_payment_id, cancelled_at nulo e sem linha
--     em subscription_provisionings (qualquer status: 'blocked' também conta
--     como feito, igual ao Set `feitos` do worker); ou
--   • payment_links new_org com paid_at e alguma payment_link_charges cujo
--     provider_charge_id não está no livro.
-- Os limites de lote do worker (LOTE*4, LOTE*2) não entram: o gate só pergunta
-- se existe pendente.

BEGIN;

CREATE OR REPLACE FUNCTION public.invoke_process_workflow_executions()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_url TEXT;
  v_secret TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.workflow_executions
    WHERE (status = 'running' AND (next_run_at IS NULL OR next_run_at <= now()))
       OR (status = 'processing' AND updated_at < now() - interval '10 minutes')
       OR (status = 'waiting_response' AND next_run_at IS NOT NULL AND next_run_at <= now())
  ) AND NOT EXISTS (
    SELECT 1 FROM public.workflow_button_questions q
    JOIN public.workflow_executions e
      ON e.id = q.execution_id AND e.organization_id = q.organization_id
    WHERE q.state = 'queued'
      AND e.status = 'paused' AND e.current_node_id = q.node_id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.workflow_button_questions q
    JOIN public.workflow_executions e
      ON e.id = q.execution_id AND e.organization_id = q.organization_id
    WHERE q.state IN ('sending', 'uncertain') AND q.send_check_count < 12
      AND q.send_started_at <= clock_timestamp() - interval '2 minutes'
      AND (q.next_send_check_at IS NULL OR q.next_send_check_at <= clock_timestamp())
      AND e.status = 'paused' AND e.current_node_id = q.node_id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.workflow_button_questions q
    JOIN public.workflow_executions e
      ON e.id = q.execution_id AND e.organization_id = q.organization_id AND e.status = 'paused'
    WHERE q.state = 'waiting'
      AND (q.deadline_at <= clock_timestamp() OR EXISTS (
        SELECT 1 FROM public.workflow_button_ingress i
        WHERE i.organization_id = q.organization_id AND i.question_id = q.id
          AND i.received_at < q.deadline_at
      ))
  ) THEN
    RETURN;
  END IF;

  SELECT value INTO v_url FROM public.cron_config WHERE key = 'campaign_rule_dispatch_url';
  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';

  v_url := replace(v_url, 'campaign-rule-dispatch', 'process-workflow-executions');

  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING '[workflow-cron] cron_config missing: url=%, secret=%', v_url, v_secret IS NOT NULL;
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[workflow-cron] invoke_process_workflow_executions failed: %', SQLERRM;
END;
$function$;

CREATE OR REPLACE FUNCTION public.invoke_billing_provision_worker()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_url TEXT := 'https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/billing-provision-worker';
  v_secret TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.org_subscriptions s
    WHERE s.provider_payment_id IS NOT NULL
      AND s.cancelled_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.subscription_provisionings p
        WHERE p.provider_payment_id = s.provider_payment_id
      )
  ) AND NOT EXISTS (
    SELECT 1 FROM public.payment_links l
    JOIN public.payment_link_charges c ON c.payment_link_id = l.id
    WHERE l.target_kind = 'new_org'
      AND l.paid_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.subscription_provisionings p
        WHERE p.provider_payment_id = c.provider_charge_id
      )
  ) THEN
    RETURN;
  END IF;

  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';
  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', COALESCE(v_secret, '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN OTHERS THEN NULL;
END;
$function$;

-- Reafirma a ACL de prod (postgres + service_role). CREATE OR REPLACE já
-- preserva; isto só fecha o caso de a função não existir no alvo.
REVOKE ALL ON FUNCTION public.invoke_process_workflow_executions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invoke_billing_provision_worker() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_process_workflow_executions() TO service_role;
GRANT EXECUTE ON FUNCTION public.invoke_billing_provision_worker() TO service_role;

COMMIT;
