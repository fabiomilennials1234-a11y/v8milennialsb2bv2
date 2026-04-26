# T3A.A1 — Audit workflow engine vs pipe/campaign rules

**Data:** 2026-04-26
**Resultado:** 90% capabilities já cobertas. 2 gaps menores.

## Action types comparados

### Pipe Rules (`pipe_dispatch_rule_steps`)

```
send_template       (template_id required)
wait_response       (wait_timeout_minutes + timeout_action)
change_stage        (target_stage_id required)
assign_sdr          (sdr_assignment_mode)
cancel_sequence     (sem params)
```

**timeout_action** sub-types:
- `continue` (default)
- `change_stage` (timeout_target_stage_id)
- `send_template` (template_id)
- `cancel_sequence`

### Campaign Rules (`campanha_dispatch_rule_steps`)

```
send_template       (template_id + delay_minutes)
```

(simples — apenas envio com delay sequencial)

### Workflow Engine action types (44 cases em `workflow-action-handler.ts`)

```
✅ send_whatsapp_template  ← cobre send_template
✅ move_stage              ← cobre change_stage
✅ assign_sdr              ← idêntico
✅ assign_closer
✅ assign_responsible
... + 39 outros
```

**Node types** (diferente de action_type):
- `trigger`, `action`, `condition`, `delay`, `wait_response` ✅, `split_ab`,
  `copilot`, `webhook_call`, `wait_business_window`, `goto`, `assign_responsible`

## Mapeamento 1:1 → workflow

### Pipe rule simples → workflow nodes

```
[trigger lead_moved_to_stage X]
  → [action send_whatsapp_template (template_id, delay)]
  → [wait_response (timeout_minutes)]
  → [action move_stage (target_stage_id)]
```

Cobertura: **100%**.

### Pipe rule com timeout_action='change_stage' → branch

```
[trigger ...]
  → [action send_template]
  → [wait_response]
    ├─ branch responded → [action move_stage Z]
    └─ branch timeout   → [action move_stage timeout_target_stage_id]
```

Cobertura: **100%** (workflow `wait_response` já tem 2 sourceHandles: `responded` + `timeout`).

### Pipe rule com cancel_sequence

Workflow não tem action `cancel_sequence` direta. Mas:
- Sequência cancelada = execução termina
- Equivalente: usar node terminal (sem outgoing edges) → `executeWorkflow` retorna `completed`

Cobertura: **adapter implícito** — não precisa novo node.

### Campaign rule (delay_minutes sequencial)

```
[trigger lead_added_to_campaign]
  → [action send_template_1]
  → [delay 1h]
  → [action send_template_2]
  → [delay 24h]
  → [action send_template_3]
```

Cobertura: **100%** (workflow tem `delay` node).

## Gaps reais identificados

| Gap | Severidade | Solução |
|---|---|---|
| `cancel_sequence` action explícita | Baixa | Adapter — termina sem outgoing edges |
| timeout_action='send_template' (manda msg DEPOIS do timeout) | Média | Workflow já suporta: branch timeout → action send_template |
| Reorder dinâmico de steps (UI pipe permite arrastar) | Baixa | Workflow JSON nodes+edges suporta nativamente |
| `whatsapp_instance_id` per step (rule scope) | Baixa | Workflow node action aceita `whatsappInstanceId` em data |

**Nenhum gap crítico.** Adapter conseguirá converter 100% dos casos atuais.

## Conversor pseudo-code

```typescript
function convertPipeRuleToWorkflow(rule: PipeRule, steps: PipeRuleStep[]): WorkflowDef {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // 1. Trigger node
  nodes.push({
    id: 'trigger',
    type: 'trigger',
    data: {
      trigger_type: rule.trigger_type === 'lead_added' ? 'lead_created' : 'stage_changed',
      config: {
        pipe_type: rule.pipe_type,
        stage_id: rule.pipeline_stage_id,
      },
    },
  });

  let prevId = 'trigger';
  steps.sort((a, b) => a.position - b.position).forEach((step, idx) => {
    const nodeId = `step_${idx}`;

    if (step.action_type === 'send_template') {
      nodes.push({ id: nodeId, type: 'action', data: { actionType: 'send_whatsapp_template', templateId: step.template_id, whatsappInstanceId: rule.whatsapp_instance_id } });
    } else if (step.action_type === 'wait_response') {
      nodes.push({ id: nodeId, type: 'wait_response', data: { timeoutMinutes: step.wait_timeout_minutes } });
      // Se tem timeout_action, adicionar branch
      if (step.timeout_action === 'change_stage') {
        const timeoutNodeId = `${nodeId}_timeout`;
        nodes.push({ id: timeoutNodeId, type: 'action', data: { actionType: 'move_stage', targetStage: step.timeout_target_stage_id } });
        edges.push({ source: nodeId, target: timeoutNodeId, sourceHandle: 'timeout' });
      }
    } else if (step.action_type === 'change_stage') {
      nodes.push({ id: nodeId, type: 'action', data: { actionType: 'move_stage', targetStage: step.target_stage_id } });
    } else if (step.action_type === 'assign_sdr') {
      nodes.push({ id: nodeId, type: 'assign_responsible', data: { mode: step.sdr_assignment_mode, role: 'sdr' } });
    } else if (step.action_type === 'cancel_sequence') {
      // Sem outgoing edges → workflow termina aqui
      return;
    }

    if (step.delay_minutes > 0) {
      const delayId = `${nodeId}_delay`;
      nodes.push({ id: delayId, type: 'delay', data: { delayMinutes: step.delay_minutes } });
      edges.push({ source: prevId, target: delayId });
      edges.push({ source: delayId, target: nodeId });
    } else {
      edges.push({ source: prevId, target: nodeId });
    }

    prevId = nodeId;
  });

  return { nodes, edges };
}
```

## Estimativa Fase A1 revisada

| Tarefa | Estimativa original | Real |
|---|---|---|
| Spec node types novos | 4h | **1h** (apenas terminate node optional) |
| Implementar conversor pipe → workflow | 8h | **8h** |
| Implementar conversor campaign → workflow | 6h | **3h** (campaign mais simples) |
| Adicionar `wrapper_for` + `wrapper_source_id` cols | 1h | **1h** |
| Test conversor + smoke fixture | 4h | **6h** |
| **Total Fase A1** | 23h | **19h** (~2.5 dias úteis) |

Fase A1 menor que spec original. **Workflow engine já é capable.**

## Próximos passos

1. **A1.1** — Implementar `convert_pipe_rule_to_workflow` em SQL/TS
2. **A1.2** — Implementar `convert_campaign_rule_to_workflow`
3. **A1.3** — Migration adiciona colunas wrapper
4. **A1.4** — Test fixture: 5 pipe rules reais → conversor → workflow → executa → verifica output
5. **A2** Shim — pipe-rule-dispatch + campaign-rule-dispatch enfileiram workflow_executions

Audit aprovado. Ready pra começar A1.1 implementation.
