---
tags:
  - claude-code
  - feature
  - torque-crm
  - automacao
created: 2026-04-12
last_updated: 2026-04-26
status: active
---

# Workflow Builder

## O que faz

Editor visual de automacoes (DAG) baseado em React Flow. Usuarios criam workflows com nodes drag-drop: trigger, action (send_whatsapp, move_stage, add_tag, assign_responsible), condition, delay, wait_response, split_ab, copilot, webhook_call, wait_business_window. 29+ trigger types, 25+ action types, 12 node types.

> [!info] Trilha 3.A — Workflow é fonte única de execucao (2026-04-26)
> Pipe rules + campaign rules agora geram **wrapper workflows** internamente
> via `convert_pipe_rule_to_workflow` + `convert_campaign_rule_to_workflow`
> RPCs. Marcados via `workflows.wrapper_for IN ('pipe_rule', 'campaign_rule')`
> + `wrapper_source_id`. UI dessas features nao muda.
> Dispatchers antigos (`pipe-rule-dispatch`, `campaign-rule-dispatch`) viraram
> shims que cancelam items de rules com wrapper. Workflow engine assume.
> Drop crons + tabelas legadas: +30d soak (A4 cleanup futuro).

## Regras de negocio

- Workflow precisa de pelo menos 1 trigger node para ser ativado
- `loop_limit` previne execucoes infinitas (default configuravel)
- Execucoes trackadas com status: pending/running/completed/failed/paused
- Cada step registrado individualmente para auditoria granular
- Suporta import/export (portabilidade entre orgs) via `useWorkflowPortability()`
- Trigger types incluem: lead_created, stage_changed, tag_added, score_reached, cron, webhook, etc.

## Como o usuario usa

1. Automacoes → Nova Automacao
2. Editor visual abre com canvas em branco
3. Arrasta nodes do sidebar (trigger, actions, conditions, delays)
4. Conecta nodes com edges (define o fluxo)
5. Configura cada node no sidebar panel (ex: qual template enviar, qual stage mover)
6. Ativa o workflow
7. Monitora execucoes em Automacoes → Execucoes

## Edge cases

- Workflow sem trigger nao pode ser ativado
- Node condition com formula invalida falha silenciosamente (step status=failed)
- wait_response sem timeout adequado pode travar execucao (mitigado por loop_limit)
- Import de workflow de outra org pode ter referencias externas invalidas (templates, stages) — validacao no import

---

## Como funciona (tecnico)

### Componentes

- `src/pages/Automacoes.tsx` — Lista de workflows
- `src/pages/AutomacoesEditor.tsx` — Editor visual (React Flow canvas)
- `src/pages/AutomacoesExecucoes.tsx` — Historico de execucoes
- `src/components/automacoes/WorkflowCanvas.tsx` — Canvas principal
- `src/components/automacoes/WorkflowSidebar.tsx` — Sidebar com nodes draggaveis
- `src/components/automacoes/WorkflowToolbar.tsx` — Toolbar (salvar, ativar, importar, exportar)
- `src/components/automacoes/nodes/` — Definicoes visuais de cada tipo de node
- `src/components/automacoes/edges/` — Tipos de conexao
- `src/components/automacoes/sidebar-panels/` — Paineis de configuracao por tipo de node

### Hooks

- `useWorkflows()` — Lista todos os workflows da org
- `useWorkflow(id)` — Detalhe de um workflow
- `useCreateWorkflow()` / `useDeleteWorkflow()` — CRUD
- `useToggleWorkflow()` — Ativar/desativar
- `useWorkflowPortability()` — Import/export entre orgs

### Edge Functions

- `process-workflow-executions` — Cron 1 min, batch 20. Processa fila de execucoes pendentes.

### Shared Modules

- `_shared/workflow-executor.ts` — Engine de execucao do workflow
- `_shared/workflow-action-handler.ts` — Handler de cada tipo de acao
- `_shared/workflow-condition-evaluator.ts` — Avaliador de condicoes (if/else)
- `_shared/workflow-trigger.ts` — Logica de triggers

### Tabelas

- `workflows` — trigger_type, trigger_config JSONB, definition JSONB (nodes + edges do React Flow), loop_limit, is_active, organization_id
- `workflow_executions` — workflow_id, lead_id, status, current_node_id, loop_counters JSONB, context JSONB, error
- `workflow_execution_steps` — execution_id, node_id, node_type, node_label, status, input_data JSONB, output_data JSONB

### Types

- `src/types/workflow.ts` — Tipos abrangentes para 29+ triggers, 25+ actions, 12 node types, operators de condicao, statuses de execucao

### Fluxo de dados

```
Evento trigger (lead_created, stage_changed, cron, etc.)
  → INSERT workflow_executions (status=pending)
    → pg_cron 1 min → process-workflow-executions
      → workflow-executor.ts pega batch de 20
        → Para cada node: executa acao → registra step → avanca para proximo node
          → Se condition: avalia e segue branch true/false
          → Se delay: pausa execucao, retoma no proximo ciclo
          → Se wait_response: aguarda resposta do lead
        → Completa ou falha → UPDATE status
```

---

## Historico de mudancas

## Links relacionados

- [[Campanhas]]
- [[Regras de Pipe]]
- [[Copilot]]
- [[Follow-ups]]

---

## wait_business_window — Time-Aware (Onda 5, 2026-04-27)

Node ganhou capacidade de múltiplas janelas customizáveis com 3 ações distintas. Reusa resolver `time-context.ts` shared com Copilot.

### Schema do node
```ts
WaitBusinessWindowNodeData = {
  // Legacy (retrocompat fallback)
  days?, startTime?, endTime?, timezone?
  // Novo
  windows?: Array<{
    id, name, days[], start: HH:MM, end: HH:MM,
    action: "pass" | `hold_until:${name}` | `route:${branchKey}`
  }>;
  mode?: "hold" | "route" | "hybrid";
}
```

### 3 ações por janela
- **pass**: continua pela edge default
- **hold_until:X**: pausa execução, `next_run_at = computeNextWindowStart(X)`, re-evaluação no cron
- **route:X**: sai pelas edges com `sourceHandle === X` (saídas múltiplas no node)

### Resolução
First-match wins. Se nenhuma janela ativa → fallback hold até primeira janela com action=pass abrir. Wrap midnight suportado (end ≤ start). Timezone-aware via `Intl.DateTimeFormat`.

### Frontend
- `WaitBusinessWindowNode.tsx` renderiza handles dinâmicos: amber por janela route + emerald default
- `WaitBusinessWindowPanel.tsx` (sidebar): até 6 janelas, dropdown action por janela, modo global hold/route/hybrid
- Designer arrasta edges entre handles nomeados — sourceHandle persiste como branchKey

### Backfill
Migration `20260921000000_workflow_wait_business_window_v2` migrou workflows existentes:
- Janela "Comercial" derivada de days/startTime/endTime
- action=pass + mode=hold
- Mapeamento PT→EN (seg→mon, etc)

2 workflows Milennials backfilled em prod. Retrocompat 100%.

### Cron auto-resume
`process-workflow-executions` cron 1min lê `workflow_executions WHERE status='running' AND next_run_at <= NOW()`. Hold_until apenas seta `next_run_at` no instante de abertura da janela alvo — herda mecanismo legacy.

### Reuso vs Copilot
| Componente | Compartilhado? |
|------------|----------------|
| `resolveActiveWindow` | ✅ |
| `windowMatches` | ✅ |
| `getDayKey/HourMinutesInTimezone` | ✅ |
| `buildDateInTimezone` (slot futuro) | ⚠️ usado só Copilot (schedule_meeting) |
| `computeNextWindowStart` (próxima abertura) | ⚠️ usado só Workflow |

### Testes
- 30/30 unit time-context (5 novos `computeNextWindowStart`)
- 5/5 E2E prod (backfill, pass, hold_until, route, fallback)

Ver: [[ADR-2026-04-27-workflow-time-aware-window]] e [[ADR-2026-04-26-copilot-time-aware-behavior]]
