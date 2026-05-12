# Migration Plan — Automações RPC Consolidation

## Ordem de aplicação

```
20261001000000_consolidate_workflow_rpcs.sql
20261001000001_pgnet_cleanup_cron.sql
20261001000002_resolve_wait_response_by_phone.sql
20261001000003_schedule_cron_health_check.sql
```

Aplicar nesta ordem exata. As migrations são idempotentes (`IF EXISTS` / `OR REPLACE`).

## Aplicação em dev

```bash
supabase db push --project-ref bcfadphgsibjzivtbjvc
supabase functions deploy cron-health-check --project-ref bcfadphgsibjzivtbjvc
```

## Pré-deploy em prod (validação)

Antes de tocar em prod, rodar **no projeto de prod** (`jsjsmuncfkbsbzqzqhfq`) para confirmar root cause:

```sql
-- 1. Confirma que há overloads duplicadas hoje
SELECT proname, pg_get_function_identity_arguments(oid) AS args
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('claim_workflow_executions', 'fire_workflow_trigger')
ORDER BY proname;
-- Esperado: 2 rows por nome (1-arg + 2-arg / 4-arg + 5-arg)

-- 2. Confirma secret config
SELECT key, length(value) AS len, substr(value, 1, 8) AS prefix
FROM public.cron_config
WHERE key IN ('cron_secret', 'campaign_rule_dispatch_url');

-- 3. Confirma queue pg_net
SELECT count(*) AS total, min(created) AS oldest
FROM net._http_response;
-- Se >100k linhas ou oldest > 30d → cleanup é urgente

-- 4. Backlog atual
SELECT status, count(*), min(started_at) AS oldest
FROM public.workflow_executions
WHERE started_at > NOW() - INTERVAL '24 hours'
GROUP BY status;

-- 5. Última execução cron
SELECT jobname, status, start_time
FROM cron.job_run_details jrd
JOIN cron.job j ON j.jobid = jrd.jobid
WHERE jobname IN ('process-workflow-executions', 'workflow-cron-triggers')
ORDER BY start_time DESC LIMIT 10;
```

Anexar resultados em `Obsidian/.../07 — Changelog/2026-05-12-rpc-consolidation-uat.md` antes de seguir pro deploy prod.

## Deploy prod (apenas com autorização explícita do CTO)

```bash
# Aplicar migrations
supabase db push --project-ref jsjsmuncfkbsbzqzqhfq

# Deploy edge function
supabase functions deploy cron-health-check --project-ref jsjsmuncfkbsbzqzqhfq
```

## Verificação pós-deploy

```sql
-- 1. Confirmar única overload
SELECT proname, count(*)
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('claim_workflow_executions', 'fire_workflow_trigger')
GROUP BY proname;
-- Esperado: 1 row por nome com count=1

-- 2. Confirmar cron jobs
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname IN ('pgnet_response_cleanup', 'cron_health_check');
-- Ambos devem estar active=true

-- 3. Disparar health-check manualmente
SELECT public.invoke_cron_health_check();

-- 4. Verificar log de health-check
SELECT * FROM public.runtime_logs
WHERE module = 'workflow' AND action = 'cron_health_check'
ORDER BY created_at DESC LIMIT 5;
```

Esperado em (4): `status='success'` com `payloadSnapshot.edge_probe_status` ∈ {200, 400}. Se `401` → drift está real e o health-check já está cumprindo seu papel.

## Rollback

Cada migration é reversível individualmente:

### Rollback 20261001000000 (RPC consolidation)

Restaura ambas as overloads regredidas re-executando as migrations originais:

```sql
-- Re-aplica versão 1-arg simples
\i supabase/migrations/20260901100000_fix_wait_response_node.sql
-- Re-aplica versão 4-arg sem chain depth
\i supabase/migrations/20260818000000_fix_workflow_executor_infrastructure.sql
```

(Re-introduz a regressão. Não recomendado salvo emergência.)

### Rollback 20261001000001 (pg_net cleanup)

```sql
SELECT cron.unschedule('pgnet_response_cleanup');
```

### Rollback 20261001000002 (resolve_wait_response_by_phone)

```sql
DROP FUNCTION public.resolve_wait_response_by_phone(text, uuid, text);
```

Os callers nos webhooks falham com erro logado (não bloqueante — fire-and-forget com `.then(err)` handler).

### Rollback 20261001000003 (cron health check)

```sql
SELECT cron.unschedule('cron_health_check');
DROP FUNCTION public.invoke_cron_health_check();
```

E retire `[functions.cron-health-check]` do `config.toml` no próximo deploy.

## Janela recomendada

- **Dev**: qualquer hora.
- **Prod**: janela de baixo tráfego (madrugada BRT). Drop+recreate de função pode causar `function "f" does not exist` em queries em flight (~ms de gap).
