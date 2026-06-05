---
date: 2026-06-05
type: feature
branch: feat/pipelines/standard-stage-custom-target
target: develop
modules: [pipelines]
---

# Feature — etapa de sucesso de pipe padrão pode destinar para funil customizado

## Contexto

Ao marcar uma etapa como **sucesso** (`is_final_positive`), o admin podia
configurar um pipe **destino** — mas só pipes padrão (`whatsapp`, `confirmacao`,
`propostas`, `upsell_base`, `upsell_gestao`) apareciam. Funis **customizados** da
org nunca entravam na lista.

Causa raiz (assimetria):

- `custom_pipeline_stages` tem 4 colunas de destino: `target_pipeline_id` +
  `target_stage_id` (→ funil custom) e `target_pipe_type` + `target_stage_key`
  (→ pipe padrão). `CustomPipeSettingsDialog` já mostrava lista unificada.
- `pipeline_stages` (pipes padrão) só tinha o par `target_pipe_type` /
  `target_stage_key`. O dropdown era hardcoded (`ALL_PIPE_TYPES`) e o schema nem
  tinha coluna para apontar para um funil custom.

Segundo problema: a execução da transição nos pipes padrão era incompleta —
`PipeWhatsapp` só criava entry em `propostas` (e `confirmacao` via modal); destino
configurado mas não executado era uma armadilha silenciosa.

## Mudanças (3 camadas)

### Camada 1 — Schema
- **Migration `20261121000000_pipeline_stages_custom_pipe_target.sql`** — adiciona
  `target_pipeline_id` (FK `custom_pipelines`, `ON DELETE SET NULL`) e
  `target_stage_id` (FK `custom_pipeline_stages`, `ON DELETE SET NULL`) em
  `pipeline_stages`. Índice parcial em `target_pipeline_id`. Constraint
  `chk_pipeline_stages_target_exclusive` — destino é custom XOR standard (espelha
  `chk_target` de `custom_pipe_transitions`). `NULL/NULL` (sem transição) válido.
- Types regen (hand-patch em `types.ts` + `contracts/pipe/pipe-entities.ts` —
  `PipelineStage` ganhou os 2 campos). **Deploy do schema = sessão CTO** (dev
  baseline divergente; prod só com autorização).

### Camada 2 — UI/hooks
- **`TransitionSelector.tsx` (NOVO, `components/shared/`)** — extraído do
  `CustomPipeSettingsDialog` (era privado lá). Lista unificada: pipes padrão +
  funis custom da org, grava no par de colunas correto. Generalizado com
  `currentPipelineId?` (exclui funil custom de origem) **e** `currentPipeType?`
  (exclui pipe padrão de origem). Reusado pelos dois dialogs → mata a duplicação.
- **`ManagePipelineStagesModal.tsx`** — dropdown hardcoded substituído pelo
  `TransitionSelector`. State dos 4 targets + persistência. Badge de transição
  mostra nome do funil custom destino.
- **`usePipelineStages` + `PipelineStage`** — mutation update e tipo aceitam
  `target_pipeline_id` / `target_stage_id`.

### Camada 3 — Execução
- **`lib/stageTransition.ts` (NOVO)** — `upsertLeadIntoCustomPipe()`: idempotente
  por (lead, funil) — move entry existente ou cria nova em `custom_pipe_entries`.
  RLS (`organization_id = get_user_organization_id()`) é o gate final; sem
  cross-org. `useMoveLeadInCustomPipe` (custom→custom) refatorado para reusar o
  helper.
- **`PipeWhatsapp` / `PipeConfirmacao` / `PipePropostas`** — branch additivo: ao
  cair em etapa de sucesso com destino custom, chama o helper + invalida
  `custom_pipe_entries`. Lógica padrão existente (closer_id, meeting modal,
  CompareceuModal, TinyERP) preservada. Guard `hasCustomTarget` evita que o
  fallback `confirmacao`/`propostas` dispare modal por engano em destino custom.

## Verificação

- `tsc --noEmit`: 0 erros.
- ESLint (9 arquivos): 0 errors (só warnings `no-explicit-any` pré-existentes).
- `npm run build`: ✓ built (26s).
- Testes: `stage-transition-custom-pipe.test.ts` 2/2 (insert + move idempotente);
  regressão `use-pipeline-stages` + `use-custom-pipelines` +
  `hooks-sprint2-pipeline-stages` = 61/61.

## Gap conhecido (não-escopo)

- **Upsell como destino de pipe padrão**: carteira usa `upsell_clients` (modelo
  distinto de `pipeline_entries`). A execução custom→upsell já existe em
  `useMoveLeadInCustomPipe`, mas standard→upsell não foi wired (fora do escopo
  desta feature; sem guesswork sobre `upsell_clients`).

## Refs
- Migration: `supabase/migrations/20261121000000_pipeline_stages_custom_pipe_target.sql`
- Memory: [[reference_pipe_views_compat]]
