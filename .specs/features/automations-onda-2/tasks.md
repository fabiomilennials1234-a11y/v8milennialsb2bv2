# Tasks — Onda 2

Legenda: `[P]` paralelo | `→ T#` depende

## Fase A — DB (4h)

### T2.A.1 [P] — Migration system_alerts
- **Where:** `supabase/migrations/<ts>_create_system_alerts.sql`
- **Done when:** tabela existe + RLS + índices
- **Test:** INSERT direto + SELECT com RLS habilitado
- **Req:** REQ-O2.4
- **Estimativa:** 1h

### T2.A.2 [P] — Migration audit_log + partman
- **Where:** `supabase/migrations/<ts>_create_audit_log.sql`
- **Done when:** tabela criada, particionada por mês via pg_partman
- **Test:** INSERT direto + verify partitions
- **Req:** REQ-O2.5
- **Estimativa:** 1.5h

### T2.A.3 — Trigger genérica audit_table_change
- **Where:** mesma migration ou separada
- **Done when:** UPDATE em leads (via service_role) cria entry em audit_log
- **Test:** simular update + verify row em audit_log com diff correto
- **Req:** REQ-O2.5
- **Depends on:** T2.A.2
- **Estimativa:** 1.5h

### T2.A.4 — Aplicar trigger em 4 tabelas críticas
- **Where:** migration
- **Tables:** leads, conversations, pending_ai_actions, workflow_executions
- **Done when:** triggers ativas
- **Req:** REQ-O2.5
- **Depends on:** T2.A.3
- **Estimativa:** 0.5h

## Fase B — Logger (3h)

### T2.B.1 [P] — Migration runtime_logs adiciona duration/tokens
- **Where:** `supabase/migrations/<ts>_runtime_logs_perf_columns.sql`
- **Done when:** colunas + índice composto criados
- **Req:** REQ-O2.2
- **Estimativa:** 0.5h

### T2.B.2 — Patch _shared/logger.ts aceita durationMs + tokens
- **Where:** `supabase/functions/_shared/logger.ts`
- **Done when:** logRuntime escreve novas colunas quando passadas
- **Test:** unit test com mock supabase
- **Req:** REQ-O2.2
- **Depends on:** T2.B.1
- **Estimativa:** 1h

### T2.B.3 — Header x-edge-function injetado em todos os clients edge
- **What:** `_shared/supabase-client.ts` (criar se não existe) wrapper que injeta header
- **Where:** _shared
- **Done when:** todas edge functions chamam supabase via wrapper
- **Test:** verify audit_log.actor_function populado em test mutation
- **Req:** REQ-O2.5
- **Depends on:** T2.A.4
- **Estimativa:** 1.5h

## Fase C — Instrumentação (4h)

### T2.C.1 [P] — Latência + tokens em agent-engine LLM calls
- **Where:** `supabase/functions/agent-message/agent-engine.ts` (todos os await openRouter.chat)
- **Done when:** runtime_logs ganha entries com duration_ms, prompt_tokens, completion_tokens, llm_model
- **Test:** dev — disparar agent-message + query runtime_logs
- **Req:** REQ-O2.2
- **Depends on:** T2.B.2
- **Estimativa:** 1.5h

### T2.C.2 [P] — Latência em process-ai-actions
- **Where:** `process-ai-actions/index.ts`
- **Done when:** runtime_logs entry por action processada com duration_ms
- **Req:** REQ-O2.2
- **Depends on:** T2.B.2
- **Estimativa:** 0.5h

### T2.C.3 [P] — Latência em workflow-executor (por node + total)
- **Where:** `_shared/workflow-executor.ts`
- **Done when:** logRuntime emite duration por node + total da execução
- **Req:** REQ-O2.2
- **Depends on:** T2.B.2
- **Estimativa:** 1h

### T2.C.4 [P] — Latência em outbound-trigger + outbound-sender
- **Req:** REQ-O2.2
- **Depends on:** T2.B.2
- **Estimativa:** 1h

## Fase D — Alerts (4h)

### T2.D.1 — Auto-disable webhook + create system_alert
- **Where:** `process-webhook-deliveries/index.ts`
- **Done when:** webhook com 10 falhas consecutivas vira `is_active=false` + alert criado
- **Test:** simular webhook respondendo 500 10x → verify is_active false + alert exists
- **Req:** REQ-O2.4
- **Depends on:** T2.A.1
- **Estimativa:** 2h

### T2.D.2 — Worker stuck → alert
- **What:** Detector que roda no cron de retry-dead-letter-jobs: cria alert se >5 dead_letter no mesmo action_type em 24h
- **Where:** `retry-dead-letter-jobs/index.ts` patch
- **Done when:** alert categoria `dead_letter_pattern` criado quando aplica
- **Req:** REQ-O2.1 (alimenta dashboard)
- **Depends on:** T2.A.1
- **Estimativa:** 2h

## Fase E — Frontend (10h)

### T2.E.1 — Edge function `reprocess-job` (master only)
- **What:** aceita `{ job_type, job_id }` → re-enqueue. Auth: master JWT.
- **Where:** `supabase/functions/reprocess-job/index.ts`
- **Done when:** master pode reprocessar pending_ai_actions ou workflow_executions
- **Req:** REQ-O2.1
- **Estimativa:** 2h

### T2.E.2 [P] — Hook useAutomationHealth
- **Where:** `src/hooks/useAutomationHealth.ts`
- **Done when:** retorna stats agregadas de 4 categorias
- **Req:** REQ-O2.1
- **Estimativa:** 1.5h

### T2.E.3 — Página `/master/automation-health`
- **Where:** `src/pages/master/AutomationHealth.tsx`
- **Done when:** layout + 4 tabs funcionais (dead-letter, workflows, actions, webhooks) + botão reprocess
- **Test:** Playwright fluxo navegação + reprocess
- **Req:** REQ-O2.1
- **Depends on:** T2.E.1, T2.E.2
- **Estimativa:** 4h

### T2.E.4 [P] — Hook useWorkflowErrors + Aba "Erros" em /automacoes
- **Where:** `src/hooks/useWorkflowErrors.ts` + `src/pages/AutomacoesExecucoes.tsx` (tab nova ou rota)
- **Done when:** lista erros + expand step + botão retry
- **Req:** REQ-O2.3
- **Estimativa:** 3h

### T2.E.5 [P] — Banner system_alerts em /configuracoes/webhooks
- **Where:** `src/components/system-alerts/Banner.tsx` + integration na página webhooks
- **Done when:** alerts críticos aparecem como banner; user pode "marcar como resolvido"
- **Req:** REQ-O2.4
- **Estimativa:** 2h

### T2.E.6 — Aba Audit no AutomationHealth
- **Where:** novo tab + filtros
- **Done when:** master vê audit_log com filtros table/op/range/org
- **Req:** REQ-O2.5
- **Depends on:** T2.E.3
- **Estimativa:** 2h

## Resumo

| Fase | Tasks | Tempo |
|---|---|---|
| A — DB | 4 | 4.5h |
| B — Logger | 3 | 3h |
| C — Instrumentação | 4 | 4h (3 paralelas) |
| D — Alerts | 2 | 4h |
| E — Frontend | 6 | ~14h |
| **Total** | **19** | **~25h** |

## Critério de fechamento

- Master abre `/master/automation-health` e vê 4 categorias com dado real
- Org admin vê erros de workflow com retry funcional
- Audit log captura mutações via service_role em 4 tabelas críticas
- Webhook com 10 falhas é auto-desativado + alert visível
