---
tags:
  - claude-code
  - feature
  - torque-crm
  - automacao
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# Workflow Builder

## O que faz

Editor visual de automacoes (DAG) baseado em React Flow. Usuarios criam workflows com nodes drag-drop: trigger, action (send_whatsapp, move_stage, add_tag, assign_responsible), condition, delay, wait_response, split_ab, copilot, webhook_call, wait_business_window. 29+ trigger types, 25+ action types, 12 node types.

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
- Import de workflow de outra org pode ter referencias externas invalidas (templates, stages) - validacao no import

---

## Como funciona (tecnico)

### Componentes

- `src/pages/Automacoes.tsx` - Lista de workflows
- `src/pages/AutomacoesEditor.tsx` - Editor visual (React Flow canvas)
- `src/pages/AutomacoesExecucoes.tsx` - Historico de execucoes
- `src/components/automacoes/WorkflowCanvas.tsx` - Canvas principal
- `src/components/automacoes/WorkflowSidebar.tsx` - Sidebar com nodes draggaveis
- `src/components/automacoes/WorkflowToolbar.tsx` - Toolbar (salvar, ativar, importar, exportar)
- `src/components/automacoes/nodes/` - Definicoes visuais de cada tipo de node
- `src/components/automacoes/edges/` - Tipos de conexao
- `src/components/automacoes/sidebar-panels/` - Paineis de configuracao por tipo de node

### Hooks

- `useWorkflows()` - Lista todos os workflows da org
- `useWorkflow(id)` - Detalhe de um workflow
- `useCreateWorkflow()` / `useDeleteWorkflow()` - CRUD
- `useToggleWorkflow()` - Ativar/desativar
- `useWorkflowPortability()` - Import/export entre orgs

### Edge Functions

- `process-workflow-executions` - Cron 1 min, batch 20. Processa fila de execucoes pendentes.

### Shared Modules

- `_shared/workflow-executor.ts` - Engine de execucao do workflow
- `_shared/workflow-action-handler.ts` - Handler de cada tipo de acao
- `_shared/workflow-condition-evaluator.ts` - Avaliador de condicoes (if/else)
- `_shared/workflow-trigger.ts` - Logica de triggers

### Tabelas

- `workflows` - trigger_type, trigger_config JSONB, definition JSONB (nodes + edges do React Flow), loop_limit, is_active, organization_id
- `workflow_executions` - workflow_id, lead_id, status, current_node_id, loop_counters JSONB, context JSONB, error
- `workflow_execution_steps` - execution_id, node_id, node_type, node_label, status, input_data JSONB, output_data JSONB

### Types

- `src/types/workflow.ts` - Tipos abrangentes para 29+ triggers, 25+ actions, 12 node types, operators de condicao, statuses de execucao

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

- [[00 - INDEX]]
- [[MOC - Features]]

- [[Webhooks]]

- [[WhatsApp Evolution]]

- [[Campanhas]]
- [[Regras de Pipe]]
- [[Copilot]]
- [[Follow-ups]]
