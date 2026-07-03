# 2026-07-02

## Mudanças

- **workflows/automacoes**: novo node de ação **Marcar Item do Checklist** (`mark_checklist_item`). No editor de automações o autor escolhe um checklist (template) + um item (2 dropdowns) e a ação **Marcar** ou **Desmarcar**. Em runtime, o node acha a cópia daquele item no checklist do lead pela linhagem `template_item_id` e alterna `is_completed`. Marcar o último item pendente conclui o checklist inteiro; desmarcar reabre. Checklist ausente no lead → no-op com sucesso (registrado no log da execução), nunca falha o DAG. PRD #966, issues #967/#968/#969, ADR-0016.
- **engagement/checklists**: itens de checklist do lead agora carregam **linhagem** (`checklist_items.template_item_id`) de volta ao item do template de origem. Preenchido nos 3 caminhos de cópia (handler `apply_checklist`, trigger de stage, apply manual). Backfill em prod: **1792/1792** itens.
- **fix**: o apply manual de template (`useApplyChecklistTemplate`) passou a setar `source_template_id` — **mata o bug de checklists duplicados** do mesmo template no lead (furava `uniq_checklists_lead_source`).

## Arquivos tocados

- `supabase/migrations/20261201000000_checklist_item_template_lineage.sql` — coluna `template_item_id` (self-FK, `ON DELETE SET NULL`) + index parcial + backfill `(title,position)` por `source_template_id` + trigger `apply_stage_checklist` reescrito (sobre a versão fixada `20261032000003`, nested-IF) carimbando linhagem. **Aplicada em prod.**
- `supabase/functions/_shared/action-handlers/checklist-item-marker.ts` — deep module (resolver mark/unmark + rollup de conclusão server-side).
- `supabase/functions/_shared/action-handlers/checklist-operations.ts` — `apply_checklist` carimba `template_item_id`.
- `supabase/functions/_shared/action-handlers/index.ts` — registro `mark_checklist_item`.
- `supabase/functions/_shared/workflow-action-handler.ts` — routing do case + import.
- `src/types/workflow.ts` — action type `mark_checklist_item` + `ActionNodeData` (`checklistItemTemplateId`, `checklistItemTitle`, `checklistItemAction`) + label + categoria Lead.
- `src/modules/workflows/components/sidebar-panels/ActionPanel.tsx` — `MarkChecklistItemConfig` (2 dropdowns + toggle Marcar/Desmarcar).
- `src/modules/engagement/hooks/useChecklistTemplates.ts` — linhagem + `source_template_id` + pre-check idempotente no apply manual.
- `src/integrations/supabase/types.ts` — `checklist_items.template_item_id` (surgical).
- `tests/unit/action-handlers/checklist-item-marker.test.ts` — 11 casos (match, no-op ausente, no-match, dup copies, rollup, unmark, reopen, fallback).
- `tests/unit/action-handlers/checklist-operations.test.ts` — +1 linhagem.
- `tests/integration/stage-auto-checklist.test.ts` — +1 linhagem no trigger.
- `tests/helpers/supabase-mock.ts` — update persiste (read-after-write) + `getUpdated`; `mockTable` clona rows (isola consts de teste).

## Decisões

- **Endereçamento por linhagem, não por texto** (ADR-0016). O node guarda `template_item_id` (id do item no template), não o título — sobrevive a rename e é inequívoco sob títulos duplicados. Alternativa "casar por texto" rejeitada.
- **Sem escrita explícita em `lead_history` pelo resolver** — igual ao toggle manual da UI. O executor de workflow, porém, mantém seu audit-log genérico de ações com sucesso (mesmo padrão do `apply_checklist`).
- **Rollup de conclusão server-side** só neste caminho — `checklists.is_completed` passou a ser setado pelo servidor ao completar/reabrir via node (antes, só computado no client).

## Follow-ups

- **Deploy prod do edge fn** `process-workflow-executions` (empacota o executor + resolver): `supabase functions deploy process-workflow-executions --project-ref jsjsmuncfkbsbzqzqhfq`. Action nodes rodam só nesse worker (`fireTrigger` só enfileira).
- **Deploy frontend** (manual, EasyPanel) pra expor o node no editor.
- Rodar `tests/integration/stage-auto-checklist.test.ts` com Supabase local (precisa env).
- Naturais sobre a mesma fundação `template_item_id`: **trigger** `checklist_item_completed`/`checklist_completed` + **condition node** por estado de item.
