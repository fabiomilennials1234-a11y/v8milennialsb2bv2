---
type: reference
title: Cron Jobs (pg_cron)
status: active
created: 2026-05-15
updated: 2026-06-30
tags: [reference, cron, pg-cron, pg-net]
related: ["[[Edge Functions]]", "[[Runbook — Cron e Webhooks]]", "[[Env Vars]]"]
owner: gabriel
---

# Cron Jobs — Reference

> **~39 jobs** agendados via `pg_cron`. Extraídos de `cron.schedule(...)` em
> `supabase/migrations/` (regenerado 2026-06-30 a partir do código, não de snapshot).
> Invocação via `pg_net` (`net.http_post`) → edge function, OU statement SQL puro
> (DELETE/UPDATE de housekeeping).
> Auth dos jobs que chamam edge fn: header `x-cron-secret`, lido de
> `public.cron_config` (key `cron_secret`), **não** de `current_setting('app.cron_secret')`.
> Listagem viva: `SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;`

> [!warning] Migrations são append-only; jobs são re-agendados várias vezes
> Os schedules abaixo refletem a **última** migration que tocou cada job (guard
> `IF EXISTS … unschedule … schedule` idempotente). A fonte da verdade absoluta é
> sempre `cron.job` no banco — esta tabela é a intenção declarada no repo.

## Grupo A — Dispatchers / workers (pg_net → edge fn, `x-cron-secret`)

Cada job roda `SELECT public.invoke_<x>()`, um wrapper `SECURITY DEFINER` que
lê URL+secret de `public.cron_config` e faz `net.http_post` para a edge fn
homônima com header `x-cron-secret`.

| job | schedule | alvo (edge fn) | auth | migration de origem |
|---|---|---|---|---|
| `process-webhook-deliveries` | `* * * * *` | `process-webhook-deliveries` | x-cron-secret | `20260211000002` |
| `campaign-rule-dispatch` | `* * * * *` | `campaign-rule-dispatch` | x-cron-secret | `20260310000000` |
| `process-outbound-dispatches` | `*/5 * * * *` | `process-outbound-dispatches` | x-cron-secret | `20260312000000` |
| `process-copilot-followups` | `*/5 * * * *` | `process-copilot-followups` | x-cron-secret | `20260313000002` |
| `process-followup-automations` | `*/5 * * * *` | `process-followup-automations` | x-cron-secret | `20260320000001` |
| `process-scheduled-user-messages` | `* * * * *` | `process-scheduled-user-messages` | x-cron-secret | `20260329000001` |
| `history-sync-worker` | `* * * * *` | `history-sync-worker` | x-cron-secret | `20261001000004` |
| `mass-send-status-poll` | `*/2 * * * *` | `mass-send-status` | x-cron-secret | `20261001000004` |
| `copilot_v2_worker` | `* * * * *` | `copilot-v2-worker` | x-cron-secret | `20260601020907` |
| `followup-reclassify` | `*/5 * * * *` | `classify-followup-stages` | x-cron-secret | `20260608000007` |
| `pipe-rule-dispatch` | `* * * * *` | `pipe-rule-dispatch` | x-cron-secret | `20260707000000` |
| `process-ai-actions` | `* * * * *` | `process-ai-actions` | x-cron-secret | `20260731000000` |
| `retry-dead-letter-jobs` | `*/5 * * * *` | `retry-dead-letter-jobs` | x-cron-secret | `20260801000000` |
| `process-workflow-executions` | `* * * * *` | `process-workflow-executions` | x-cron-secret | `20260818000000` |
| `workflow-cron-triggers` | `* * * * *` | `process-workflow-executions` (modo trigger) | x-cron-secret | `20260818000000` |
| `refresh-meta-tokens` | `0 2 * * *` | `refresh-meta-tokens` | x-cron-secret | `20260819000000` |
| `cron_health_check` | `*/5 * * * *` | `cron-health-check` | x-cron-secret | `20261001000003` |
| `whatsapp_dlq_replay` | `*/5 * * * *` | `whatsapp-dlq-replay` | x-cron-secret | `20261012000001` |
| `whatsapp_session_watchdog` | `*/10 * * * *` | `whatsapp-session-watchdog` | x-cron-secret | `20261012000003` |
| `whatsapp_health_monitor` | `*/5 * * * *` | `whatsapp-health-monitor` | x-cron-secret | `20261012000005` |
| `whatsapp_media_retry` | `*/2 * * * *` | `whatsapp-media-retry` | x-cron-secret | `20261016000001` |
| `event-dispatcher` | `* * * * *` | `event-dispatcher` | x-cron-secret | `20261105000001` |
| `blast-plan-release` | `5 12 * * *` | `blast-plan-release` | x-cron-secret | `20261122000000` |
| `meta-leadgen-poll` | `*/5 * * * *` | `meta-leadgen-poll` | x-cron-secret | `20261128000005` |
| `meta-conversion-dispatch` | `*/10 * * * *` | `meta-conversion-dispatch` | x-cron-secret | `20261128000007` |

Notas:
- `workflow-cron-triggers` e `process-workflow-executions` apontam para a **mesma**
  edge fn `process-workflow-executions` (não existe pasta `workflow-cron-triggers/`);
  o wrapper diferencia o modo no body.
- `copilot_v2_worker` invoca `copilot-v2-worker`, mas o Copilot v2 está **inerte** em
  prod (rebuild isolado) — ver [[Áreas Frágeis]].

## Grupo B — Housekeeping / retenção (SQL puro, sem edge fn, sem `x-cron-secret`)

Rodam um `DELETE`/`UPDATE`/função `plpgsql` direto no banco. Não saem do Postgres,
logo **não usam** `pg_net` nem `x-cron-secret`.

| job | schedule | alvo (SQL) | migration de origem |
|---|---|---|---|
| `send-dedup-log-cleanup` | `*/5 * * * *` | `DELETE public.send_dedup_log` | `20260523000000` |
| `cron-health-monitor` | `*/5 * * * *` | `public.check_cron_job_health()` | `20260927000000` |
| `cleanup-automation-jobs` | `0 2 * * *` | `DELETE public.automation_jobs` | `20260801000000` |
| `cleanup_runtime_logs_90d` | `0 3 * * *` | `DELETE public.runtime_logs` (>90d) ¹ | `20260728000000` |
| `cleanup_usage_events_180d` | `0 4 * * *` | `DELETE public.usage_events` (>180d) | `20260729000000` |
| `pgnet_response_cleanup` | `0 3 * * *` | `DELETE net._http_response` | `20261001000001` |
| `cleanup-copilot-batching` | `0 3 * * *` | `public.cleanup_copilot_message_queue()` | `20261027000000` |
| `purge-deleted-whatsapp-conversations` | `0 3 * * *` | `DELETE public.whatsapp_messages` ² | `20261218000004` |
| `cron-job-run-details-retention` | `17 3 * * *` | `DELETE cron.job_run_details` (>1d) | `20261119000017` |
| `purge-deleted-leads-log` | `17 3 * * *` | `DELETE public.deleted_leads_log` | `20261125000000` |
| `agent-decision-logs-retention` | `23 3 * * *` | `DELETE public.agent_decision_logs` (>30d) | `20261119000017` |
| `raw-payload-retention` | `33 3 * * *` | `UPDATE public.whatsapp_messages SET raw_payload=NULL` (>14d) | `20261119000017` |
| `whatsapp-dlq-retention` | `43 3 * * *` | `DELETE public.whatsapp_webhook_dlq` | `20261119000019` |
| `purge-runtime-logs-2d` | `0 4 * * *` | `DELETE public.runtime_logs` (>2d) ¹ | `20261231000000` |

¹ **`runtime_logs` tem dois jobs.** `cleanup_runtime_logs_90d` (criado em
  `20260728000000`) nunca foi removido por migration, mas `purge-runtime-logs-2d`
  (`20261231000000`, retenção de 2 dias) é o efetivo — a janela de 2d sempre
  apaga antes da de 90d. Conferir `cron.job` em prod; um deles pode ter sido
  removido out-of-band.

² **Histórico de dataloss.** `purge-deleted-whatsapp-conversations` foi criado em
  `20260330000000` e **corrigido** em `20261218000004_fix_whatsapp_purge_reused_number.sql`
  (apagava histórico de número reusado por não filtrar timestamp da mensagem).
  Ver [[Áreas Frágeis]] / incidente cron purge.

## Notas de schedule (stagger)

- `20260427210000_stagger_pg_cron_jobs.sql` prefixou `SELECT pg_sleep(N)` em 8 jobs
  de `* * * * *` para espalhar a largada (todos disparavam no mesmo segundo) —
  **schedule não mudou**, só o comando.
- `20261119000010_unstagger_remove_pg_sleep.sql` **removeu** o `pg_sleep` (revert do
  stagger). Os jobs voltaram ao comando original; schedule inalterado.

## Padrão da migration (wrapper + schedule)

```sql
-- 1) Wrapper SECURITY DEFINER que lê config de public.cron_config
CREATE OR REPLACE FUNCTION public.invoke_<x>()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_url TEXT; v_secret TEXT;
BEGIN
  SELECT value INTO v_url    FROM public.cron_config WHERE key = 'campaign_rule_dispatch_url';
  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';
  IF v_url IS NULL OR v_secret IS NULL THEN RETURN; END IF;
  v_url := replace(v_url, 'campaign-rule-dispatch', '<fn-name>');
  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', v_secret),
    body    := '{}'::jsonb
  );
END $$;

-- 2) Schedule idempotente (guard contra pg_cron ausente + re-schedule)
DO $outer$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='<jobname>') THEN
    PERFORM cron.unschedule('<jobname>');
  END IF;
  PERFORM cron.schedule('<jobname>', '*/5 * * * *', 'SELECT public.invoke_<x>()');
END $outer$;
```

`public.cron_config` (criada em `20260211000002`) guarda `*_url` + `cron_secret`,
com RLS `USING (false) WITH CHECK (false)` — só `service_role` lê. **Sem isso a
URL/secret ficaria hardcoded na migration.**

## Como verificar

```sql
-- Lista jobs ativos
SELECT jobid, jobname, schedule, active, command
FROM cron.job ORDER BY jobname;

-- Execuções recentes
SELECT jobname, status, return_message, start_time, end_time
FROM cron.job_run_details
WHERE start_time > now() - interval '1 hour'
ORDER BY start_time DESC LIMIT 50;

-- Falhas nas últimas 24h
SELECT jobname, return_message, start_time
FROM cron.job_run_details
WHERE status='failed' AND start_time > now() - interval '24 hours'
ORDER BY start_time DESC;
```

## Como pausar / despausar / remover

```sql
SELECT cron.alter_job(job_id := <id>, active := false);  -- pausa
SELECT cron.alter_job(job_id := <id>, active := true);   -- despausa
SELECT cron.unschedule('<jobname>');                     -- remove
```

> [!tip] torque-mcp
> Toggle de cron jobs também via tool `cron_toggle` do torque-mcp (auditado).

## Auth `x-cron-secret`

- Secret: `public.cron_config` key `cron_secret` (tabela service-role-only).
- Header enviado: `x-cron-secret: <valor>`.
- Validação dentro da edge fn: comparar header com env `CRON_SECRET`.
- **Correção vs. doc antigo:** os wrappers leem de `cron_config`, **não** de
  `current_setting('app.cron_secret')` (só 1 migration menciona esse setting).

## Gotchas

- **pg_net é Supabase-only.** Todo o Grupo A depende dele; os jobs do Grupo B (SQL
  puro) não — rodam mesmo sem pg_net.
- **Schedule é UTC.** `0 9 * * *` = 09:00 UTC = 06:00 BRT (-3h). Os jobs de retenção
  rodam de madrugada UTC (`17 3`, `23 3`, `33 3`, `43 3`) justamente escalonados.
- **Job retorna void.** Erros aparecem em `cron.job_run_details`, não param o cron.
- **Backpressure:** edge fn lenta + cron `* * * * *` pode acumular execuções.
- **Rotação do secret:** `UPDATE public.cron_config SET value=... WHERE key='cron_secret'`
  (+ rotacionar env `CRON_SECRET` nas edge fns). Não precisa de `ALTER DATABASE`.
- **Re-agendar = unschedule + schedule.** Toda migration nova segue o guard
  idempotente; nunca editar uma migration já aplicada (ver `migrations/CLAUDE.md`).
- **`cron_health_check` vs `cron-health-monitor`:** dois jobs distintos —
  `cron_health_check` chama a edge fn `cron-health-check`; `cron-health-monitor`
  roda a função SQL `check_cron_job_health()` direto no banco.

## Runbook

Ver [[Runbook — Cron e Webhooks]] para incident response.
