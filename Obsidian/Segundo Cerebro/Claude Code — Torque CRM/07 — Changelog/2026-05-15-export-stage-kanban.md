---
type: changelog
title: 2026-05-15 — Export Stage Kanban
status: shipped
created: 2026-05-15
updated: 2026-05-15
tags: [uncategorized]
related: []
owner: gabriel
---

# 2026-05-15 — Export Stage Kanban

## Mudanças

- **kanban**: novo item "Exportar leads desta etapa" no menu de 3-pontinhos
  da coluna do Kanban (whatsapp / confirmacao / propostas / custom).
- **hook**: `useExportLeads` ganha `stageFilter` + `stageTitle` opcionais —
  mantém compat 100% com export global (zero mudança no schema CSV nem
  nas chamadas existentes).
- **componente**: `ExportStageDialog` novo (formato CSV/XLSX, count exibido,
  permissão `export_leads` validada, botão disabled em etapa vazia).

## Arquivos tocados

- `src/hooks/useExportLeads.ts` — novo `ExportStageFilter`, `slugify()` e
  branch que pré-filtra `lead_ids` por etapa antes da query de `leads`.
- `src/components/kanban/DraggableKanbanBoard.tsx` — prop `onExportStage`,
  ícone `FileDown`, condicional do dropdown ajustada para `(onExportStage || onDeleteAllLeads)`.
- `src/components/kanban/ExportStageDialog.tsx` — novo.
- `src/pages/PipeWhatsapp.tsx` — wire `onExportStage` + dialog.
- `src/pages/PipeConfirmacao.tsx` — idem.
- `src/pages/PipePropostas.tsx` — idem.
- `src/components/custom-pipelines/CustomPipelineKanban.tsx` — wire com
  `customPipelineId` para `custom_pipe_entries`.
- `tests/unit/useExportLeads.stageFilter.test.ts` — 7 testes (whatsapp /
  confirmacao / propostas / custom / custom-sem-pipelineId / etapa-vazia /
  regressão sem stageFilter).

## Decisões

- **Negocios.tsx fora de escopo** — usa `useDeals`/tabela `deals`, schema
  diferente dos pipes do CRM. Não compartilha o contrato CSV.
- **CampanhaKanban fora de escopo** — implementa Kanban próprio, não usa
  `DraggableKanbanBoard`. Exportar campanha não casa com o schema de leads.
- **Pre-filter via lead_ids** (em vez de JOIN) — mantém o resto do hook
  intocado, garante zero regressão no schema CSV (47 colunas) e cobre
  os 4 pipes com a mesma branch.
- **Permission gate em duas camadas** — hook (já existia) + dialog (novo,
  mesmo padrão do `ExportLeadsModal` global).

## Follow-ups

- `package.json` declara `exceljs ^4.4.0` mas o devbox local não tinha
  o pacote instalado. Após `npm install exceljs --no-save`, todos os
  testes que tocam `useExportLeads` / `useImportLeads` passam.
  Verificar pipeline de CI: se passar lá, não precisa ação. Se falhar,
  rodar `npm install` (provavelmente alguém deu commit no `package.json`
  sem rodar install).
- Considerar centralizar `slugify()` em `@/lib/utils` se outros lugares
  precisarem do mesmo helper (hoje só o filename de export usa).
