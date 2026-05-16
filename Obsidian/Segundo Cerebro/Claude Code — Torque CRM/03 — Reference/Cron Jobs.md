---
type: reference
title: Cron Jobs (pg_cron)
status: active
created: 2026-05-15
updated: 2026-05-15
tags: [reference, cron, pg-cron]
related: ["[[Edge Functions]]", "[[Runbook — Cron e Webhooks]]"]
owner: gabriel
---

# Cron Jobs — Reference

> 10+ jobs ativos. Schedule via `pg_cron`, invocação via `pg_net` → edge fn.
> Auth via header `x-cron-secret`.
> Listagem viva: `SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;`

## Jobs ativos (snapshot 2026-05-15)

| jobname | schedule | edge fn invocada | função |
|---|---|---|---|
| `whatsapp_dlq_replay` | `*/5 * * * *` | `whatsapp-dlq-replay` | Replay DLQ de webhooks que falharam |
| `whatsapp_health_monitor` | `*/5 * * * *` | `whatsapp-health-monitor` | Drift + health checks |
| `whatsapp_session_watchdog` | `*/10 * * * *` | `whatsapp-session-watchdog` | Detecta sessões mortas |
| `webhook-deliveries` | `* * * * *` | (interno) | Retry de webhook outbound |
| `workflow-executions` | `* * * * *` | `workflow-trigger` | Step runner de workflows |
| `outbound-dispatches` | `* * * * *` | `outbound-trigger` | Envio de msgs outbound do copilot |
| `ai-actions` | `* * * * *` | `_shared/ai-action-executor` | Ações IA agendadas |
| `campaign-rule-dispatch` | `* * * * *` | `campaign-rule-dispatch` | Dispatch por stage |

(Lista pode estar desatualizada — verificar com SQL acima.)

## Padrão da migration

```sql
SELECT cron.schedule(
  '<jobname>',
  '<schedule>',  -- ex: '*/5 * * * *'
  $$
  SELECT net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/<fn-name>',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.cron_secret', true)
    ),
    body := '{}'::jsonb
  );
  $$
);
```

## Como verificar

```sql
-- Lista jobs
SELECT jobid, jobname, schedule, active, command
FROM cron.job
ORDER BY jobname;

-- Execuções recentes
SELECT jobname, status, return_message, start_time, end_time
FROM cron.job_run_details
WHERE start_time > now() - interval '1 hour'
ORDER BY start_time DESC
LIMIT 50;

-- Falhas recentes
SELECT jobname, return_message, start_time
FROM cron.job_run_details
WHERE status = 'failed'
  AND start_time > now() - interval '24 hours'
ORDER BY start_time DESC;
```

## Como pausar / despausar

```sql
SELECT cron.alter_job(job_id := <id>, active := false);  -- pausa
SELECT cron.alter_job(job_id := <id>, active := true);   -- despausa
```

## Como remover

```sql
SELECT cron.unschedule('<jobname>');
```

## Auth `x-cron-secret`

- Setting: `app.cron_secret` (database setting)
- Header: `x-cron-secret: <valor>`
- Validação dentro da edge fn: comparar header com env var

## Gotchas

- **pg_net é Supabase-only.** Cron depende.
- **Schedule UTC.** `0 9 * * *` = 09:00 UTC = 06:00 BRT (-3h).
- **Job retorna void.** Erros aparecem em `job_run_details`, não param o cron.
- **Backpressure**: se edge fn lenta + cron 1min, pode acumular execuções.
- **Cron secret rotation**: requer migration nova com `ALTER DATABASE ... SET app.cron_secret`.

## Runbook

Ver [[Runbook — Cron e Webhooks]] para incident response.
