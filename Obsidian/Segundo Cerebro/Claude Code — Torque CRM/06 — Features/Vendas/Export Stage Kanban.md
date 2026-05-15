# Export Stage (Kanban)

## O que é

Exportação de leads filtrada por etapa do Kanban. Cada coluna do Kanban
(qualquer pipe — `whatsapp`, `confirmacao`, `propostas` ou pipelines `custom`)
ganhou no menu de 3-pontinhos a ação **"Exportar leads desta etapa"**, que
abre um diálogo leve para escolher o formato (CSV ou Excel) e disparar
a exportação somente dos leads que estão naquela etapa.

Reutiliza por completo o pipeline existente de export global (`useExportLeads`)
para garantir o mesmo schema CSV (lead + 3 pipes) e a mesma camada de
permissão (`export_leads`).

## Como funciona

1. `DraggableKanbanBoard` aceita o prop opcional `onExportStage(stageId, stageTitle)`.
   Quando fornecido (ou `onDeleteAllLeads`), o header da coluna mostra o
   `DropdownMenu` com os itens "Exportar leads desta etapa" (cor padrão) e
   "Mover todos para lixeira" (destrutivo). Cada item só aparece se o
   handler correspondente for passado.
2. Cada caller do `DraggableKanbanBoard` mantém um state local
   `stageToExport: { id, title, count } | null` e renderiza
   `<ExportStageDialog>` quando preenchido.
3. `ExportStageDialog` chama `useExportLeads({ format, stageFilter, stageTitle })`.
4. `useExportLeads` com `stageFilter`:
   - Pipes fixos: query em `pipe_whatsapp` / `pipe_confirmacao` / `pipe_propostas`
     filtrando por `organization_id` + `status = stageId`. Pega `lead_id` distintos.
   - Custom: query em `custom_pipe_entries` filtrando `organization_id`,
     `pipeline_id = customPipelineId`, `stage_id = stageId`.
   - Depois roda a query padrão de `leads` adicionando `.in("id", leadIds)`.
   - Pipes laterais continuam sendo trazidos para preencher o CSV completo.
   - Se `leadIds.length === 0`, retorna `{ count: 0 }` sem gerar arquivo.

### Contrato — `ExportLeadsOptions.stageFilter`

```ts
stageFilter?: {
  pipe: "whatsapp" | "confirmacao" | "propostas" | "custom";
  stageId: string;            // status enum (pipes fixos) ou UUID stage (custom)
  customPipelineId?: string;  // obrigatório quando pipe === "custom"
};
stageTitle?: string;          // só usado para compor o nome do arquivo
```

### Filename

- Sem `stageFilter`: `leads_export_YYYY-MM-DD.{csv|xlsx}` (preservado).
- Com `stageFilter`: `leads_{pipe}_{slug(stageTitle ?? stageId)}_YYYY-MM-DD.{csv|xlsx}`.

### Arquivos chave

- Hook: `src/hooks/useExportLeads.ts`
- Diálogo: `src/components/kanban/ExportStageDialog.tsx`
- Board: `src/components/kanban/DraggableKanbanBoard.tsx` (prop `onExportStage`)
- Callers wired:
  - `src/pages/PipeWhatsapp.tsx` (pipe="whatsapp")
  - `src/pages/PipeConfirmacao.tsx` (pipe="confirmacao")
  - `src/pages/PipePropostas.tsx` (pipe="propostas")
  - `src/components/custom-pipelines/CustomPipelineKanban.tsx` (pipe="custom" + `customPipelineId`)

### Callers fora de escopo

- `src/pages/Negocios.tsx` — usa `useDeals`/tabela `deals`, não os pipes
  do CRM. Schema diferente, fora do contrato compartilhado.
- `src/components/campanhas/CampanhaKanban.tsx` — implementa Kanban próprio,
  não usa `DraggableKanbanBoard`. Campanhas têm seu próprio fluxo de
  extração para pipes; exportar etapa de campanha não casa com o schema
  CSV de leads.

## Regras de negócio

- Permissão `export_leads` é checada tanto no hook (já existia) quanto no
  diálogo (nova camada client-side, mesmo padrão do `ExportLeadsModal`
  global). Sem permissão, botão "Exportar" fica desabilitado.
- `leadCount = 0` desabilita o botão e mostra "Nenhum lead em '<etapa>'."
- Multi-tenant: TODA query nova passa `eq("organization_id", organizationId)`.
- Schema CSV mantém os mesmos 47 cabeçalhos da exportação global —
  zero divergência entre os dois fluxos.

## Edge cases

- Etapa vazia → `{ count: 0 }`, sem download.
- `pipe="custom"` sem `customPipelineId` → throw imediato (`Error`).
- `leadIds` deduplicados via `Set` (mesmo lead em múltiplas linhas do pipe).
- Toast "0 leads" se a query retornar leads filtrados zerados.

## Áreas frágeis

- **Multi-tenancy**: novo path de query precisa preservar
  `organization_id`. Coberto por teste regressivo em
  `tests/unit/useExportLeads.stageFilter.test.ts`.
- **Permissões**: `export_leads` validada em duas camadas (hook + dialog).
  Não centralizada — se o feature flag mudar, atualizar ambos.

## Histórico

- 2026-05-15 — Feature criada. Hook estendido, board ganha
  `onExportStage`, diálogo novo, 4 callers wired, 7 testes unitários.
