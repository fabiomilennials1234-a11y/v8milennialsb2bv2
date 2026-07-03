# Node — Marcar Item do Checklist

Node de ação de workflow (`mark_checklist_item`) que marca ou desmarca **um item** do checklist de um lead durante uma automação. Categoria **Lead** no picker de ações.

## Por que existe

O checklist do lead era preenchido só na mão. Quando uma automação já executava a ação que um item representa (enviou proposta, agendou reunião), o box continuava desmarcado. Este node deixa o checklist ser reflexo automático do que aconteceu. O único node de checklist anterior, `apply_checklist`, apenas anexa um checklist inteiro — não toca item.

## Como o autor configura

Dois dropdowns + um toggle:
1. **Checklist (template)** — lista os templates da org.
2. **Item para marcar** — lista os itens daquele template (carregados por `useChecklistItems(templateId)`). O valor salvo é o **id do item no template**.
3. **Ação** — Marcar / Desmarcar.

Salvo em `ActionNodeData`: `checklistTemplateId`, `checklistItemTemplateId`, `checklistItemTitle`, `checklistItemAction`.

## Como resolve em runtime

`_shared/action-handlers/checklist-item-marker.ts`:

1. Pega os checklists do lead (org-scoped).
2. Acha a(s) cópia(s) do item via `checklist_items.template_item_id == checklistItemTemplateId`, dentro dos checklists do lead.
3. Seta `is_completed` (mark→true / unmark→false) e `completed_at` (now / null) em **todas** as cópias que casam (leads com checklists duplicados legados ficam consistentes).
4. **Rollup**: recomputa `checklists.is_completed` de cada checklist afetado — marca o último item pendente conclui o checklist; desmarcar reabre.

**Ausência**: se o lead não tem aquele checklist/item, o node retorna sucesso no-op com mensagem no log da execução. Nunca falha o DAG.

## Endereçamento — por que linhagem e não texto

Ver [[ADR-0016]] (`docs/adr/0016-checklist-item-template-lineage.md`). O node monta em design-time, mas a cópia do item no lead só nasce no apply (id aleatório). Casar por título quebra em rename e é ambíguo sob títulos repetidos. A coluna `checklist_items.template_item_id` dá identidade estável através da fronteira template→lead.

## Onde roda

Action nodes executam só no worker `process-workflow-executions` (via `workflow-executor` → `executeWorkflowAction`). `fireTrigger` apenas enfileira em `workflow_executions`.

## Relacionado

- Fundação: [[stage-auto-checklist]] (trigger que anexa checklist por stage — também carimba linhagem).
- Naturais na sequência (mesma fundação): trigger `checklist_item_completed`/`checklist_completed`; condition node por estado de item.
