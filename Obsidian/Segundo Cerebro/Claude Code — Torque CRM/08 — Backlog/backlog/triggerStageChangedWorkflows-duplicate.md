---
type: backlog
title: Dedupe — triggerStageChangedWorkflows client-side vs trigger server-side
status: backlog
created: 2026-04-12
updated: 2026-04-12
tags: [uncategorized]
related: []
owner: gabriel
---



# Dedupe — triggerStageChangedWorkflows client-side vs trigger server-side

## Problema

Quando `pipe_confirmacao.status` muda, dois caminhos podem disparar workflows com trigger `stage_changed`:

1. **Client-side**: `triggerStageChangedWorkflows` chamada dentro de `useUpdatePipeConfirmacao` após o UPDATE bem-sucedido.
2. **Server-side**: trigger Postgres `trg_workflow_stage_changed_confirmacao` em `AFTER UPDATE OF status`.

Em condições normais ambos disparam para o mesmo evento. Risco de execução duplicada do mesmo workflow para o mesmo lead, na mesma transição.

## Hipóteses

- Workflows usam idempotency key baseada em `(workflow_id, lead_id, transition_id)` → seguros (validar).
- Dispatcher faz dedupe via `claim_workflow_executions` lock → seguros (validar).
- Ou existe janela de race onde duplicidade passa.

## Tarefa

- [ ] Auditar `triggerStageChangedWorkflows` (client) + `trg_workflow_stage_changed_confirmacao` (server) — quem está duplicando o trabalho?
- [ ] Verificar se `workflow_executions` tem constraint UNIQUE que previne duplicidade.
- [ ] Decidir: remover client-side (single source of truth no DB) OU manter ambos com dedupe explícito.
- [ ] Mesma análise para `pipe_whatsapp` e `pipe_propostas`.

## Critérios de aceite

- Documentar fonte única de truth para `stage_changed` em [[Workflow Builder]] (ou nota equivalente).
- Test integration valida que mover stage gera exatamente 1 execução por workflow elegível.
- Se houver dedupe, está visível em código + logs.

## Notas

Possivelmente já está OK por dedupe no `claim_workflow_executions` (introduzido em D034 — Onda 1). Vale auditar antes de assumir.
