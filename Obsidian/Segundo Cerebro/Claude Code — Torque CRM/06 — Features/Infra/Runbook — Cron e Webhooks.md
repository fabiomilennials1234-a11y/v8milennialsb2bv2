# Runbook — Cron Jobs e Webhooks

**Ambiente produção**: `jsjsmuncfkbsbzqzqhfq`
**Ambiente dev**: `bcfadphgsibjzivtbjvc`

---

## Cron Jobs ativos (17 jobs)

| Job name | Schedule | Edge function |
|----------|----------|---------------|
| `process-webhook-deliveries` | `* * * * *` | process-webhook-deliveries |
| `process-ai-actions` | `* * * * *` | process-ai-actions |
| `process-workflow-executions` | `* * * * *` | process-workflow-executions |
| `workflow-cron-triggers` | `* * * * *` | process-workflow-executions (mode=cron_triggers) |
| `pipe-rule-dispatch` | `* * * * *` | pipe-rule-dispatch |
| `campaign-rule-dispatch` | `* * * * *` | campaign-rule-dispatch |
| `process-scheduled-user-messages` | `* * * * *` | process-scheduled-user-messages |
| `history-sync-worker` | `* * * * *` | history-sync-worker |
| `mass-send-status-poll` | `*/2 * * * *` | mass-send-status |
| `process-outbound-dispatches` | `*/5 * * * *` | process-outbound-dispatches |
| `process-copilot-followups` | `*/5 * * * *` | process-copilot-followups |
| `process-followup-automations` | `*/5 * * * *` | process-followup-automations |
| `retry-dead-letter-jobs` | `*/5 * * * *` | retry-dead-letter-jobs |
| `cron-health-monitor` | `*/5 * * * *` | SQL: `SELECT check_cron_job_health()` |
| `cleanup-automation-jobs` | `0 2 * * *` | SQL: delete old jobs |
| `cleanup_runtime_logs_90d` | `0 3 * * *` | SQL: delete logs > 90d |
| `cleanup_usage_events_180d` | `0 4 * * *` | SQL: delete events > 180d |
| `refresh-meta-tokens` | `0 2 * * *` | refresh-meta-tokens |

---

## Como debugar um cron job travado

### Passo 1 — Verificar status via view diagnóstica

```sql
-- Todos os jobs com status da última execução
SELECT * FROM v_cron_job_status ORDER BY minutes_since_last_run DESC;

-- Job específico
SELECT * FROM v_cron_job_status WHERE jobname = 'process-webhook-deliveries';

-- Alerta: se minutes_since_last_run > 5 para job de 1min → JOB TRAVADO
```

### Passo 2 — Ver histórico completo de execuções

```sql
-- Últimas 20 execuções de um job
SELECT
  jrd.status,
  jrd.return_message,
  jrd.start_time,
  jrd.end_time,
  EXTRACT(EPOCH FROM (jrd.end_time - jrd.start_time)) AS duration_sec
FROM cron.job_run_details jrd
JOIN cron.job j ON j.jobid = jrd.jobid
WHERE j.jobname = 'process-webhook-deliveries'
ORDER BY jrd.start_time DESC
LIMIT 20;

-- Contar falhas por job nos últimos 30 min
SELECT
  j.jobname,
  COUNT(*) FILTER (WHERE jrd.status = 'succeeded') AS successes,
  COUNT(*) FILTER (WHERE jrd.status != 'succeeded') AS failures
FROM cron.job_run_details jrd
JOIN cron.job j ON j.jobid = jrd.jobid
WHERE jrd.start_time >= NOW() - INTERVAL '30 minutes'
GROUP BY j.jobname
ORDER BY failures DESC;
```

### Passo 3 — Verificar logs da edge function

```bash
# Logs em tempo real no terminal
supabase functions logs process-webhook-deliveries \
  --project-ref jsjsmuncfkbsbzqzqhfq

# Logs na tabela runtime_logs (últimas 50 entradas)
```

```sql
SELECT module, action, status, error_message, duration_ms, created_at
FROM runtime_logs
WHERE module ILIKE '%webhook%'
ORDER BY created_at DESC
LIMIT 50;
```

### Passo 4 — Verificar se o pg_net está entregando

```sql
-- Requisições HTTP recentes do pg_net
SELECT id, created, url, status_code, error_msg
FROM net._http_response
ORDER BY created DESC
LIMIT 20;

-- Requisições com erro
SELECT * FROM net._http_response
WHERE status_code >= 400 OR error_msg IS NOT NULL
ORDER BY created DESC
LIMIT 20;
```

### Passo 5 — Verificar cron_config (URLs corretas?)

```sql
-- URLs configuradas para cada cron job
SELECT key, value FROM public.cron_config ORDER BY key;

-- Se URL estiver errada ou CRON_SECRET mudou:
UPDATE public.cron_config SET value = 'https://...' WHERE key = 'process_webhook_deliveries_url';
```

### Passo 6 — Forçar execução manual de um job

Opção A — via SQL (roda função de health check):
```sql
SELECT public.check_cron_job_health();
```

Opção B — via curl direto na edge function:
```bash
curl -X POST https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/process-webhook-deliveries \
  -H "x-cron-secret: $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Passo 7 — Reiniciar o job (caso pg_cron trave)

```sql
-- Desabilitar e reabilitar
UPDATE cron.job SET active = false WHERE jobname = 'process-webhook-deliveries';
UPDATE cron.job SET active = true  WHERE jobname = 'process-webhook-deliveries';

-- Ou recriar (substitua URL e secret pelos valores corretos):
SELECT cron.unschedule('process-webhook-deliveries');
SELECT cron.schedule(
  'process-webhook-deliveries',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT value FROM public.cron_config WHERE key = 'process_webhook_deliveries_url'),
    headers := jsonb_build_object('x-cron-secret', (SELECT value FROM public.cron_config WHERE key = 'cron_secret')),
    body := '{}'::jsonb
  )
  $$
);
```

---

## Como resetar um webhook com falha

### Cenário 1 — Webhook com circuito aberto (is_active = false)

O circuit breaker desliga um webhook após 10 falhas consecutivas e gera um `system_alert`.

```sql
-- Verificar webhooks desabilitados
SELECT id, organization_id, url, consecutive_failures, disabled_reason, is_active
FROM webhook_endpoints
WHERE is_active = false
ORDER BY updated_at DESC;

-- Reativar (após investigar a causa)
UPDATE webhook_endpoints
SET is_active = true, consecutive_failures = 0, disabled_reason = NULL
WHERE id = '<webhook-id>';

-- Resolver o alert correspondente
UPDATE system_alerts
SET resolved_at = NOW()
WHERE category = 'webhook_circuit_breaker'
  AND metadata->>'webhook_id' = '<webhook-id>'
  AND resolved_at IS NULL;
```

### Cenário 2 — Entregas presas em retry

```sql
-- Ver filas de retry por webhook
SELECT
  d.webhook_endpoint_id,
  we.url,
  COUNT(*) AS pending_deliveries,
  MIN(d.next_retry_at) AS next_retry,
  MAX(d.attempt) AS max_attempt
FROM webhook_deliveries d
JOIN webhook_endpoints we ON we.id = d.webhook_endpoint_id
GROUP BY d.webhook_endpoint_id, we.url
ORDER BY pending_deliveries DESC;

-- Ver detalhes de uma entrega específica
SELECT id, event, attempt, max_attempts, last_error, next_retry_at, created_at
FROM webhook_deliveries
WHERE webhook_endpoint_id = '<endpoint-id>'
ORDER BY created_at DESC;

-- Forçar retry imediato (zera next_retry_at para agora)
UPDATE webhook_deliveries
SET next_retry_at = NOW()
WHERE webhook_endpoint_id = '<endpoint-id>'
  AND attempt < max_attempts;
```

### Cenário 3 — Entregas no Dead Letter Queue

```sql
-- Ver dead letters por webhook
SELECT
  dl.id,
  dl.webhook_id,
  dl.event,
  dl.attempts,
  dl.last_status_code,
  dl.last_error,
  dl.created_at
FROM webhook_dead_letters dl
ORDER BY dl.created_at DESC
LIMIT 50;

-- Re-enfileirar uma dead letter (move de volta para webhook_deliveries)
INSERT INTO webhook_deliveries (
  webhook_endpoint_id, event, payload, attempt, max_attempts, next_retry_at
)
SELECT
  webhook_id, event, payload, 0, 3, NOW()
FROM webhook_dead_letters
WHERE id = '<dead-letter-id>';

-- Deletar da DLQ após re-enfileirar
DELETE FROM webhook_dead_letters WHERE id = '<dead-letter-id>';
```

### Cenário 4 — Limpar backlog massivo (emergência)

```sql
-- CUIDADO: isso descarta entregas não processadas
-- Use apenas se o endpoint destino estiver down e não vai recuperar

-- Contar antes de deletar
SELECT COUNT(*) FROM webhook_deliveries
WHERE webhook_endpoint_id = '<endpoint-id>';

-- Deletar (irreversível — confirme com CTO antes)
DELETE FROM webhook_deliveries
WHERE webhook_endpoint_id = '<endpoint-id>'
  AND created_at < NOW() - INTERVAL '24 hours';
```

---

## Alertas automáticos

O job `cron-health-monitor` (roda a cada 5min) insere em `system_alerts` quando:
- Qualquer job de 1min ou 2min falha → `severity: critical`, `category: cron_job_failure`
- Qualquer job de 1min não rodou nos últimos 15min → `severity: high`, `category: cron_job_stale`
- Circuit breaker de webhook dispara → `severity: critical`, `category: webhook_circuit_breaker`

```sql
-- Ver alertas não resolvidos
SELECT severity, category, title, description, created_at
FROM system_alerts
WHERE resolved_at IS NULL
ORDER BY created_at DESC;

-- Resolver manualmente
UPDATE system_alerts SET resolved_at = NOW() WHERE id = '<alert-id>';
```

O frontend `/master/automation-health` exibe esses alertas em tempo real via AlertsBanner.

---

## Load test

### Validação DB — MIL-12 (2026-04-27)

Script SQL executado diretamente em prod (`__integration_test_org__`):

- 60 leads inseridos em batch atômico único
- 0 erros, 0 constraint violations
- Timestamp spread: 0ms (single atomic write — DB não é o bottleneck)
- Status: **PASSOU** — DB suporta carga de 60 escritas concorrentes sem erros

### Node.js fallback (HTTP layer)

Script: `tests/load/run-load-validation.mjs`

```bash
# Precisa do WEBHOOK_API_KEY (valor do Supabase Secret do mesmo nome)
WEBHOOK_API_KEY=<valor-do-secret> \
  node tests/load/run-load-validation.mjs

# Com cleanup automático
WEBHOOK_API_KEY=<valor> \
  SUPABASE_SERVICE_ROLE_KEY=<key> \
  node tests/load/run-load-validation.mjs
```

**Auth**: usa header `x-webhook-key: $WEBHOOK_API_KEY` (global, não per-org).

### k6 (carga completa — 5 orgs × 1000 leads)

Script: `tests/load/k6-mvp-load-test.js`

```bash
# Instalar k6
brew install k6  # macOS
# ou: https://k6.io/docs/getting-started/installation/

# Configurar variáveis
export SUPABASE_URL=https://bcfadphgsibjzivtbjvc.supabase.co
export WEBHOOK_API_KEY=<valor-do-secret>
export ORG_1=<uuid-org-1>
# ... ORG_2 a ORG_5

# Rodar (dev environment — NUNCA prod sem aprovação CTO)
k6 run tests/load/k6-mvp-load-test.js \
  -e SUPABASE_URL=$SUPABASE_URL \
  -e WEBHOOK_API_KEY=$WEBHOOK_API_KEY \
  -e ORG_1=$ORG_1

# Com saída JSON para análise
mkdir -p results
k6 run tests/load/k6-mvp-load-test.js \
  -e SUPABASE_URL=$SUPABASE_URL \
  -e WEBHOOK_API_KEY=$WEBHOOK_API_KEY \
  --out json=results/load-$(date +%Y%m%d-%H%M%S).json
```

### Critérios de aprovação

| Métrica | Threshold | Status |
|---------|-----------|--------|
| DB bulk insert (60 leads) | 0 erros | ✅ 2026-04-27 |
| Lead ingest P95 (HTTP) | < 3000ms | ⬜ Pendente k6 |
| Lead ingest P99 (HTTP) | < 8000ms | ⬜ Pendente k6 |
| Webhook delivery P95 | < 2000ms | ⬜ Pendente k6 |
| Error rate | < 1% | ⬜ Pendente k6 |

---

## Realtime — verificar conexões

```sql
-- Canais realtime ativos (deve cair para zero após inatividade)
SELECT count(*) FROM realtime.subscription;

-- Subscriptions por tabela
SELECT entity, count(*)
FROM realtime.subscription
GROUP BY entity
ORDER BY count DESC;
```

Se o número de subscriptions crescer indefinidamente, o hook `useRealtimeSubscription` tem um vazamento. Verifique se o componente está chamando `supabase.removeChannel(channel)` no cleanup do useEffect. O hook atual está correto (cleanup implementado em `src/hooks/useRealtimeSubscription.ts:145`).

---

## Referências

- Supabase Dashboard (prod): https://supabase.com/dashboard/project/jsjsmuncfkbsbzqzqhfq
- Sentry: verificar project Torque CRM
- `v_cron_job_status` — view diagnóstica (disponível via SQL Editor ou PostgREST)
- `system_alerts` — alertas automáticos do monitor
- `runtime_logs` — logs de edge functions
- `webhook_dead_letters` — DLQ de webhooks
