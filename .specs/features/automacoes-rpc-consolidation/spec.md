# Spec — Automações que param de funcionar (RPC Consolidation + Health Check)

**Branch**: `fix/automacoes-rpc-consolidation`
**Data**: 2026-05-12
**Status**: implementado em dev, aguardando UAT + autorização para prod

## 1. Problema

Workflows, pipe rule dispatch, campaign rule dispatch, cron jobs e demais automações **param de funcionar intermitentemente, sem erro visível**. Sem alerta. Sem sinal claro de qual camada falhou. O sintoma reaparece após rotações de secret ou janelas de tráfego alto.

## 2. Investigação — root causes confirmadas

### H1. Cron secret drift (parada total silenciosa)

Dois pontos de configuração desacoplados:
- `cron_config.cron_secret` (tabela) — usado pelo pg_cron via pg_net
- `CRON_SECRET` env — validado pelas edge functions

Se um rotaciona sem o outro, pg_net continua disparando, edge function responde 401, pg_net engole o erro (`RAISE WARNING` em `EXCEPTION WHEN OTHERS`). Sem health check, ninguém percebe.

### H2. Race condition em `claim_workflow_executions` 1-arg

Timeline lexicográfica das migrations:

| Ordem | Migration | Mudança |
|---|---|---|
| 1 | `20260426000004_onda1_p2_hardening.sql` | criou `(int, int)` com per_org_cap + race-fix |
| 2 | `20260426000005_drop_legacy_rpc_overloads.sql` | dropou `(integer)` 1-arg |
| 3 | `20260427000000_fix_claim_workflow_executions_race.sql` | refina `(int, int)` com predicate replication no UPDATE |
| 4 | `20260802000000_workflow_executor_infrastructure.sql` | **RE-CRIA** `(int)` 1-arg simples |
| 5 | `20260803000000_fix_claim_timeouts_and_cron_dedup.sql` | re-stomp 1-arg |
| 6 | `20260901100000_fix_wait_response_node.sql` | re-stomp 1-arg adicionando `waiting_response` mas SEM per_org_cap e SEM race-fix |

Edge function chama `.rpc("claim_workflow_executions", { batch_size: 20 })`. PostgREST resolve por nomes de chave → escolhe a versão 1-arg (mais específica pra 1 key). Resultado: versão regredida ativa em prod com bug de race já conhecido (bug Viviane Sevla 2026-04-27, áudio PTT duplicado).

### H3. pg_net response queue growth

`net._http_response` sem cleanup. Padrão conhecido Supabase: queue cresce → pg_net trava silenciosamente.

### H4. Per-org starvation

Consequência de H2 — sem per_org_cap, uma org com 1000 jobs domina batch=20.

### H5. Chain depth guard bypassed

`20260818000000_fix_workflow_executor_infrastructure.sql` RE-CRIOU `fire_workflow_trigger(uuid,text,uuid,jsonb)` 4-arg SEM `chain_depth`. A versão 5-arg com guard ainda existe (`20260426000004`), mas PG triggers chamam com 4 args → bypass.

### H7. wait_response sem callers

RPC `resolve_wait_response(lead_id, org_id, channel)` foi criado em `20260901100000` mas **nenhuma edge function chama**. Workflows em `status='waiting_response'` só saem por timeout, nunca por reply do lead.

## 3. Solução aplicada

### 3.1 Migration `20261001000000_consolidate_workflow_rpcs.sql`

- DROP ambas as overloads de `claim_workflow_executions(int)` e `(int, int)`
- CREATE única versão `(batch_size int DEFAULT 20, per_org_cap int DEFAULT 5)` com:
  - per_org_cap via `ROW_NUMBER() OVER (PARTITION BY organization_id)`
  - `FOR UPDATE SKIP LOCKED`
  - **Predicate replication no `UPDATE ... WHERE`** (fecha a race condition em READ COMMITTED)
  - Reclamação de `waiting_response` com timeout vencido + `_wait_resolved=timeout` no context
- DROP ambas as overloads de `fire_workflow_trigger`
- CREATE única versão 5-arg com `p_triggered_by_execution_id uuid DEFAULT NULL`:
  - Chain depth guard (max 5)
  - Trigger_config no context (preserva comportamento da 20260818)
  - PG triggers que chamam com 4 args continuam funcionando (default NULL no 5º)
- Bloco `DO $verify$` final que **falha a migration** se qualquer overload duplicada persistir

### 3.2 Migration `20261001000001_pgnet_cleanup_cron.sql`

Cron job `pgnet_response_cleanup` daily 03:00 UTC: `DELETE FROM net._http_response WHERE created < NOW() - INTERVAL '7 days'`.

### 3.3 Migration `20261001000002_resolve_wait_response_by_phone.sql`

Novo RPC `resolve_wait_response_by_phone(p_phone text, p_organization_id uuid, p_channel text)`:
- Normaliza telefone (digits-only)
- Resolve lead(s) por org + phone normalizado
- Delega ao `resolve_wait_response` existente para cada lead encontrado
- Retorna total de execuções resolvidas

### 3.4 Edge function `cron-health-check` + Migration `20261001000003_schedule_cron_health_check.sql`

- Edge function lê `cron_config.cron_secret` e `CRON_SECRET` env
- Faz probe HTTP em `process-workflow-executions` com o secret da tabela
- Se 401 → `runtime_logs.status='error'` + Sentry (via `withSentry`)
- Cron job `cron_health_check` a cada 5min via `invoke_cron_health_check()`
- Lógica de health-check extraída para `health-check.ts` (testável em vitest)

### 3.5 Webhook callers

- `whatsapp-webhook/index.ts`: após upsert de mensagem inbound, fire-and-forget `resolve_wait_response_by_phone` (não bloqueia o webhook).
- `sz-chat-webhook/index.ts`: idem (paridade).

### 3.6 Config

`supabase/config.toml`: registrada entrada `[functions.cron-health-check] verify_jwt = false`.

## 4. Critérios de aceite

- [x] Única overload de `claim_workflow_executions` em prod (verificado pelo `DO $verify$` na migration)
- [x] Única overload de `fire_workflow_trigger` em prod (verificado pelo `DO $verify$`)
- [x] `pgnet_response_cleanup` agendado
- [x] `cron_health_check` agendado a cada 5min
- [x] `resolve_wait_response_by_phone` callado pelos 2 webhooks WhatsApp
- [x] Unit tests `cron-health-check` passam
- [ ] Integration tests rodam contra Supabase local (CI)
- [ ] UAT: 24h estável em dev sem regressão
- [ ] Aprovação CTO antes de aplicar em prod

## 5. Riscos

| Risco | Mitigação |
|---|---|
| `DROP FUNCTION` em prod com queries em flight | Aplicar em janela de baixo tráfego. Migration usa `IF EXISTS` + recreate em mesma transação. |
| 5-arg `fire_workflow_trigger` quebrar PG triggers | Default NULL no 5º parâmetro mantém compat. Testes integration validam. |
| Cleanup pg_net pode apagar evidência forense | Retém 7 dias — suficiente pra debug normal. |
| Health check adiciona tráfego | 1 call/5min = desprezível. |

## 6. Out-of-scope

- Atomicidade do outbound dispatch (H6 do investigation — requer schema separado, deferido)
- Migração pg_cron → Inngest/Trigger.dev
- Re-engenharia do scheduler (polling → push)

## 7. Próximo passo

Ver `migration-plan.md` para ordem de aplicação em dev → UAT → prod.
