# Deploy prod — Onda 1 (faseado)

**Project:** `jsjsmuncfkbsbzqzqhfq`
**Status local:** 5 commits ahead develop (Ondas 1+2 backend).
**QA dev:** PASS (P0+P1+P2+P3 + Onda 2 backend).

## Drift de migrações prod

14 migrations remotas legítimas (Uazapi + quotas + permissions de outras branches) sem colisão com Onda 1+2 (timestamps `20260426*` posteriores).

**Decisão:** aplicar via `supabase db query --linked --file` direto (skip `db push` que valida histórico). Após deploy, marcar como applied em `supabase_migrations.schema_migrations` ou rodar `db pull` pra reconciliar histórico local.

## Pré-deploy (uma vez)

```bash
# 1. Backup snapshot tabelas afetadas (rollback de emergência)
supabase link --project-ref jsjsmuncfkbsbzqzqhfq

supabase db dump --data-only --linked \
  -f /tmp/torque-backup-$(date +%F-%H%M).sql \
  --schema public \
  --table leads --table conversations --table conversation_messages \
  --table workflow_executions --table pending_ai_actions \
  --table copilot_agents

# 2. Snapshot health baseline (queries Onda 2)
supabase db query --linked --output csv "$(cat <<'SQL'
SELECT
  (SELECT COUNT(*) FROM conversations c JOIN leads l ON l.id = c.lead_id
   WHERE l.ai_disabled = true AND c.state <> 'WAITING_HUMAN') AS drift_count,
  (SELECT COUNT(*) FROM pending_ai_actions WHERE status = 'pending'
   AND created_at < now() - interval '1h') AS pending_orphan,
  (SELECT COUNT(*) FROM workflow_executions WHERE status = 'failed'
   AND started_at > now() - interval '24h') AS wf_failed_24h;
SQL
)" > /tmp/torque-baseline-$(date +%F-%H%M).csv

# 3. Snapshot top erros runtime_logs (baseline pra comparar pós-deploy)
supabase db query --linked --output csv "$(cat <<'SQL'
SELECT module, action, status, COUNT(*) cnt
FROM runtime_logs
WHERE created_at > now() - interval '7 days' AND status = 'error'
GROUP BY module, action, status ORDER BY cnt DESC LIMIT 20;
SQL
)" > /tmp/torque-errors-baseline-$(date +%F-%H%M).csv
```

## Janela: noite (22h-2h horário Brasília — uso baixo)

---

## FASE 1 — Migrations baixo risco (additive only)

Idempotentes (IF NOT EXISTS). Nada destrutivo. Sem rollback necessário se tudo passar.

```bash
supabase link --project-ref jsjsmuncfkbsbzqzqhfq

# Aplica em ordem
supabase db query --linked --file supabase/migrations/20260426000000_add_web_to_lead_origin.sql
supabase db query --linked --file supabase/migrations/20260426000002_outbound_dispatch_log_guarantee.sql
supabase db query --linked --file supabase/migrations/20260426000003_conversation_messages_idempotency.sql
```

**Verify:**
```sql
SELECT array_agg(enumlabel ORDER BY enumsortorder) FROM pg_enum WHERE enumtypid = 'public.lead_origin'::regtype;
-- esperado: ...,'web'

SELECT to_regclass('public.outbound_dispatch_log'),
       (SELECT COUNT(*) FROM pg_indexes WHERE indexname='idx_outbound_dispatch_unique_active');
-- esperado: outbound_dispatch_log,1

SELECT column_name FROM information_schema.columns
WHERE table_name='conversation_messages' AND column_name='idempotency_key';
-- esperado: idempotency_key
```

**Observe 24h:**
```sql
-- Esperado: 0 erros
SELECT COUNT(*) FROM runtime_logs
WHERE created_at > now() - interval '24h'
  AND error_message ILIKE '%lead_origin%web%';

SELECT COUNT(*) FROM runtime_logs
WHERE created_at > now() - interval '24h'
  AND error_message ILIKE '%outbound_dispatch_log%';
```

**Rollback Fase 1:** não necessário (additive). Se forçoso:
```sql
DROP INDEX IF EXISTS idx_conversation_messages_idempotency;
ALTER TABLE conversation_messages DROP COLUMN IF EXISTS idempotency_key;
-- enum web não rollbackable (ALTER TYPE ADD irreversível); valor fica órfão se não usado
```

---

## FASE 2 — RPCs + crons (24-48h depois Fase 1)

Toca dado real (backfill 115 conversas). Risco médio.

```bash
supabase db query --linked --file supabase/migrations/20260426000001_transfer_lead_to_human_rpc.sql
supabase db query --linked --file supabase/migrations/20260426000004_onda1_p2_hardening.sql
supabase db query --linked --file supabase/migrations/20260426000005_drop_legacy_rpc_overloads.sql
```

**Verify:**
```sql
SELECT proname, pg_get_function_identity_arguments(oid) AS args FROM pg_proc
WHERE proname IN ('transfer_lead_to_human','increment_conversation_turn',
                  'claim_workflow_executions','claim_pending_ai_actions',
                  'fire_workflow_trigger') ORDER BY proname;

-- Backfill check (esperado: 0 — eram 115 antes)
SELECT COUNT(*) FROM conversations c JOIN leads l ON l.id = c.lead_id
WHERE l.ai_disabled = true AND c.state <> 'WAITING_HUMAN';
```

**Deploy edge functions:**
```bash
supabase functions deploy process-workflow-executions --project-ref jsjsmuncfkbsbzqzqhfq
supabase functions deploy process-ai-actions --project-ref jsjsmuncfkbsbzqzqhfq
supabase functions deploy outbound-trigger --project-ref jsjsmuncfkbsbzqzqhfq
```

**Observe 4h** após cada deploy:
```sql
-- Latência cron jobs (Onda 2 já habilita esse log)
SELECT module, action, COUNT(*), AVG(duration_ms)::int AS avg_ms
FROM runtime_logs WHERE created_at > now() - interval '1h'
  AND module IN ('copilot','workflow') GROUP BY module, action;

-- Stuck workflow_executions (deveria virar 0 com heartbeat)
SELECT COUNT(*) FROM workflow_executions WHERE status = 'processing'
  AND updated_at < now() - interval '15 minutes';

-- Orgs consumindo batch desproporcional (per-org cap)
SELECT organization_id, COUNT(*) FROM workflow_executions
WHERE status = 'running' GROUP BY organization_id ORDER BY COUNT(*) DESC LIMIT 5;
```

**Rollback Fase 2 (se necessário):**

Edge functions: Supabase Dashboard → Functions → revert pra versão anterior (1min).

Migrations:
```sql
-- transfer_lead_to_human RPC (callers usam direto — rollback edge function primeiro)
DROP FUNCTION IF EXISTS transfer_lead_to_human(uuid);

-- increment_conversation_turn (idem — caller agent-engine)
DROP FUNCTION IF EXISTS increment_conversation_turn(uuid, text);

-- chain_depth + per-org cap RPCs: re-criar versões antigas (ver
-- supabase/migrations/20260901100000_fix_wait_response_node.sql para reference)
```

⚠️ **IMPORTANTE:** se rollbackar `drop_legacy_overloads` (`20260426000005`), precisa recriar overloads antigos manualmente. Senão callers do código novo continuam funcionando (passam 2 args), mas qualquer caller esquecido com 1 arg falha.

---

## FASE 3 — agent-message (canary) — após Fase 2 estável 48h

**Path crítico copilot.** Risco alto.

```bash
# Estratégia canary: deploy agent-message em horário noite + watch 2h
# antes de declarar estável.

supabase functions deploy agent-message --project-ref jsjsmuncfkbsbzqzqhfq
```

**Watch crítico (primeiras 2h):**
```sql
-- Latência LLM agent-message (deveria ficar abaixo de 5s p95)
SELECT
  COUNT(*) AS calls,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms) AS p50,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99
FROM runtime_logs
WHERE module = 'copilot' AND action = 'llm_call'
  AND created_at > now() - interval '2h';

-- Erros novos
SELECT action, error_message, COUNT(*)
FROM runtime_logs
WHERE module = 'copilot' AND status = 'error'
  AND created_at > now() - interval '1h'
GROUP BY action, error_message ORDER BY COUNT(*) DESC LIMIT 10;

-- Mensagens duplicadas (Onda 1 idempotency funcionando?)
SELECT conversation_id, role, COUNT(*) AS dups
FROM conversation_messages
WHERE created_at > now() - interval '1h'
GROUP BY conversation_id, role, idempotency_key
HAVING COUNT(*) > 1;
-- esperado: 0 rows (ou drasticamente reduzido vs baseline 209/30d)

-- Drift transfer (deveria continuar 0)
SELECT COUNT(*) FROM conversations c JOIN leads l ON l.id = c.lead_id
WHERE l.ai_disabled = true AND c.state <> 'WAITING_HUMAN';

-- Custo LLM por org última 1h
SELECT organization_id, SUM(prompt_tokens) AS p_tok, SUM(completion_tokens) AS c_tok, COUNT(*) AS calls
FROM runtime_logs WHERE module = 'copilot' AND action = 'llm_call'
  AND created_at > now() - interval '1h'
GROUP BY organization_id ORDER BY p_tok DESC LIMIT 10;
```

**Rollback Fase 3:** Supabase Dashboard → agent-message → revert versão (1min).

---

## Pós-deploy (24h após Fase 3)

```sql
-- Comparação top erros antes vs depois
SELECT module, action, status, COUNT(*) cnt
FROM runtime_logs
WHERE created_at > now() - interval '24h' AND status = 'error'
GROUP BY module, action, status ORDER BY cnt DESC LIMIT 20;
-- comparar com /tmp/torque-errors-baseline-*.csv

-- Esperado eliminados:
-- ✓ 24.4k erros lead_origin web → 0
-- ✓ 11.7k erros outbound_dispatch_log not found → 0
-- ✓ 10.9k erros Tipo de ação desconhecido → 0
-- ✓ 232 supabaseAdmin.from is not a function → 0
-- ✓ 209 pares assistant duplicadas → <10

-- Métrica de sucesso de feature: prompt_built logando
SELECT COUNT(*) FROM runtime_logs
WHERE action = 'prompt_built' AND created_at > now() - interval '24h';

-- success=false em decisions (era 0/607 hoje — agora deveria ter algo)
SELECT success, COUNT(*) FROM agent_decision_logs
WHERE created_at > now() - interval '24h' GROUP BY success;
```

---

## Trigger de pânico

Se reclamações > 5 clientes em 1h:

1. **Identificar fase ativa** (qual deploy mais recente)
2. **Rollback edge function** Dashboard (1min)
3. **Status page** atualizar manualmente
4. **NÃO rollback migration** sem entender impacto — migrations são reversíveis com cuidado, edge functions instantâneas
5. **Sentry + runtime_logs** correlacionar erro novo com deploy

---

## Reconciliação histórico migrações (1 vez, fim)

```bash
# Após Fase 3 estável, pull histórico prod pra local
supabase db pull --schema public

# Marcar Onda 1+2 migrations como applied
supabase migration repair --status applied 20260426000000 20260426000001 20260426000002 20260426000003 20260426000004 20260426000005 20260426010000 20260426010001 20260426010002
```

Histórico local + remoto sincronizados após esse passo.
