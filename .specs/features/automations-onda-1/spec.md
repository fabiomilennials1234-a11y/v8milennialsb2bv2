# Onda 1 — Fix crítico bleeding

**Created:** 2026-04-26
**Scope:** Large
**Owner:** Backend + DBA + AI
**Estimate:** ~30h (4 dias úteis 1 dev)
**Source:** Revisão arquitetural automações + telemetria 30d (relatório 2026-04-26)

## Contexto

Investigação multi-agente identificou 13 fixes prioritários distribuídos em P0/P1/P2/P3 baseados em incidência real:

- 1.522 workflow_executions 30d → 31.5% failed
- 256 pending_ai_actions 30d → 25% failed
- 47k+ erros runtime_logs concentrados em 3 root causes (enum, tabela faltante, action desconhecida)
- 115/115 conversas com transferência human dessincronizadas (`leads.ai_disabled=true` mas `conversations.state≠WAITING_HUMAN`)
- 209 pares de assistant messages duplicadas em <60s

Itens já corrigidos antes desta onda (auditoria confirmou): C1 (loop SK cap), C4 (idempotency_key), A2 (recover fallback), A7 (ciclo cron), M3 (whitelist), M4 (sanitizer fallback). **Não estão neste backlog.**

## Goals

- Eliminar top 5 root causes de erro recorrente (P0)
- Eliminar duplicação de mensagens assistant via idempotência + heartbeat (P1)
- Hardening de race conditions e proteções preventivas (P2)
- Restaurar observabilidade mínima de decisão de copilot (P3)

## Non-goals

- Refactor de engines (Trilha 3)
- Dashboard novo de visibilidade (Onda 2)
- Reescrita de copilot (Trilha 3)

## Requisitos rastreáveis

### P0 — Stop the bleeding (~9h)

**REQ-P0.1** — Sistema deve aceitar `web` como valor válido para `leads.origin`.
- Aceitação: 0 erros `invalid input value for enum lead_origin: "web"` em runtime_logs por 24h após deploy
- Source: 24.440 retries + 33 dead_letter (30d)

**REQ-P0.2** — Cron `process-outbound-dispatches` deve operar sem erro de tabela inexistente.
- Aceitação: 0 erros `Could not find the table 'public.outbound_dispatch_log'` em 24h
- Source: 11.775 erros (30d)
- Decisão pendente: criar tabela ou desativar cron + remover function

**REQ-P0.3** — AI action executor deve registrar handlers para `generate_message` e `send_product_material`.
- Aceitação: 0 erros `Tipo de ação desconhecido: generate_message` em 24h
- Source: 10.881 retries + 8 dead_letter (30d)

**REQ-P0.4** — Transferência para humano deve ser atômica entre `leads.ai_disabled` e `conversations.state`.
- Aceitação: query de drift retorna 0 conversas divergentes em snapshot pós-deploy
- Source: 115/115 conversas (100%) divergentes hoje
- Implementação: RPC `transfer_lead_to_human(p_lead_id uuid)` em transação única

**REQ-P0.5** — Edge function de execução de workflow deve importar Supabase corretamente.
- Aceitação: 0 erros `supabaseAdmin.from is not a function` em 24h
- Source: 232 failures concentradas em 1 workflow (30d)

### P1 — Duplicação + travamentos (~9h)

**REQ-P1.1** — Workflow executor deve emitir heartbeat (`updated_at = NOW()`) antes de cada node.
- Aceitação: nenhuma execução é reclamada por `claim_workflow_executions` enquanto está ativa <10min
- Source: causa raiz das 209 dups assistant + risco de double-send em workflows

**REQ-P1.2** — `outbound_dispatch_log` (após criada em P0.2 ou tabela equivalente) deve ter UNIQUE constraint que previne duplicate dispatch.
- Aceitação: tentar inserir 2 dispatches `(lead_id, agent_id)` com status pending|sent retorna `23505`
- Implementação: UNIQUE INDEX + `ON CONFLICT DO NOTHING` no insert

**REQ-P1.3** — `executeAiAction` deve abortar após 30s.
- Aceitação: ação travada não bloqueia batch >30s; status vira `failed` com `error_message='timeout'` e entra retry
- Source: 6 pending órfãs há 4 dias

**REQ-P1.4** — `conversation_messages` insert deve ter idempotency_key composto.
- Aceitação: tentar inserir 2x mesma `(conversation_id, idempotency_key)` retorna 1 row apenas
- Implementação: coluna `idempotency_key text` + UNIQUE partial index + key derivada de `(turn_count, message_hash)`

### P2 — Hardening preventivo (~8h)

**REQ-P2.1** — `turn_count` em conversations deve incrementar atomicamente.
- Aceitação: 100 mensagens simultâneas → turn_count incrementa exatamente 100x
- Implementação: `UPDATE conversations SET turn_count = turn_count + 1 WHERE id = ?` ou RPC

**REQ-P2.2** — `workflow_executions` deve rastrear chain de triggering e bloquear loops profundos.
- Aceitação: workflow A→B→A não cria 3ª execução
- Implementação: coluna `triggered_by_execution_id uuid` + check `chain_depth < 5` no `fire_workflow_trigger`

**REQ-P2.3** — `claim_pending_ai_actions` e `claim_workflow_executions` devem distribuir batch entre orgs.
- Aceitação: org com 1000 jobs pendentes não consome >50% do batch enquanto outras orgs têm jobs
- Implementação: window function `ROW_NUMBER() OVER (PARTITION BY organization_id ORDER BY created_at)` + `WHERE rn <= per_org_cap`

### P3 — Observabilidade base (~4h)

**REQ-P3.1** — `agent_decision_logs.success=false` deve ser registrado em todos os caminhos de falha.
- Aceitação: snapshot pós-deploy mostra >0 entries com success=false (não 0/607 como hoje)

**REQ-P3.2** — Idempotency key timestamp granularity de 1min deve incluir nonce de turn.
- Aceitação: 2 ações idênticas em T+31s não colidem nem duplicam
- Implementação: `${actionType}_${leadId}_${conversation.turn_count}` em vez de `${ts}`

**REQ-P3.3** — `buildDynamicPrompt` deve emitir log de tamanho final em runtime_logs.
- Aceitação: cada chamada loga `prompt_chars`, `prompt_estimated_tokens` em payload_snapshot
- Permite alertar quando exceder limite

## Dependências externas

- Acesso a Supabase produção `jsjsmuncfkbsbzqzqhfq` para deploys de migrations + edge functions
- Acesso a dev `bcfadphgsibjzivtbjvc` para validação prévia
- Cron secret válido em ambos ambientes

## Riscos

- **R1:** Migration P0.4 (transfer atomic) altera path crítico. Rollback plan: function antiga mantida 7d com nome `_legacy`.
- **R2:** REQ-P2.3 (per-org cap) pode reduzir throughput global se mal calibrado. Cap inicial: 30% do batch_size, ajustar via observação.
- **R3:** P1.1 heartbeat cria carga adicional de UPDATE em workflow_executions (1 por node). Aceitável: nodes são <100/exec; carga < 0.01% do volume atual.

## Métricas de sucesso (24h pós deploy completo)

| Métrica | Baseline | Target |
|---|---|---|
| `runtime_logs` errors `lead_origin web` | 24.440/30d (~815/dia) | 0 |
| `runtime_logs` errors `outbound_dispatch_log` | 11.775/30d (~393/dia) | 0 |
| `runtime_logs` errors `Tipo de ação desconhecido` | 10.881/30d (~363/dia) | 0 |
| Conversas com transfer divergente | 115/115 (100%) | 0% |
| `supabaseAdmin.from is not a function` failures | 232/30d (~8/dia) | 0 |
| Pares assistant duplicadas <60s | 209/30d | <10/30d |
| `pending_ai_actions` órfãs >24h | 6 ativas | 0 |
