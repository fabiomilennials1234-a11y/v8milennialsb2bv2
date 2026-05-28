---
status: ativo
owner: arquiteto
tipo: inventario-execucao
fase: 7
slice: 7.1
criado: 2026-05-28
relacionados:
  - "[[fase-7-quebrar-ciclo-leads-pipelines]]"
  - "[[_INDEX]]"
---

# Inventário Fase 7 Slice 7.1 — leads ↔ pipelines deep imports

Snapshot 2026-05-28 ~20:00 UTC, develop @ `3c5a1a21`.

## Totais medidos

| Direção | Deep imports |
|---|---:|
| `leads → pipelines` | **38** |
| `pipelines → leads` | **9** |
| **Total ciclo** | **47** |

## Breakdown por path source

### leads → pipelines (38)

| Subpasta consumida | Count |
|---|---:|
| `pipelines/hooks/` | 33 |
| `pipelines/components/` | 5 |

### pipelines → leads (9)

| Subpasta consumida | Count |
|---|---:|
| `leads/hooks/` | 6 |
| `leads/components/` | 3 |

## Top consumers (arquivos com mais deep imports)

### leads → pipelines

| Arquivo | Imports |
|---|---:|
| `leads/pages/Leads.tsx` | 5 |
| `leads/components/leads/LeadModal.tsx` | 5 |
| `leads/components/leads/funnel-contexts/ConfirmacaoContext.tsx` | 4 |
| `leads/components/lead-detail/cross-pipe/MeetingFieldBlock.tsx` | 4 |
| `leads/components/lead-detail/modal/pipes/CrossPipePanel.tsx` | 3 |
| `leads/components/lead-detail/cross-pipe/BudgetFieldBlock.tsx` | 3 |
| `leads/components/leads/funnel-contexts/{WhatsApp,Propostas}Context.tsx` | 2 + 2 |
| `leads/components/leads/PropostaModal.tsx` | 2 |
| `leads/components/lead/create/LeadCreateForm.tsx` | 2 |

### pipelines → leads

| Arquivo | Imports |
|---|---:|
| `pipelines/pages/PipeWhatsapp.tsx` | 3 |
| `pipelines/pages/PipePropostas.tsx` | 3 |
| `pipelines/pages/PipeConfirmacao.tsx` | 3 |

(Padrão visível: 3 pages × 3 símbolos = 9. Provavelmente mesmo trio de imports replicado.)

## Símbolos cruzados — classificação por bucket

### Bucket 1 — Tipos + helpers puros (zero side-effect)

Movimentação: trivial. Não precisa extrair pra `shared/types/` — basta promover ao barrel `pipelines/index.ts`.

| Símbolo | De |
|---|---|
| `PipePropostasStatus` (type) | `pipelines/hooks/usePipePropostas` |
| `PipeConfirmacaoStatus` (type) | `pipelines/hooks/usePipeConfirmacao` |
| `PipeWhatsappStatus` (type) | `pipelines/hooks/usePipeWhatsapp` |
| `getPipelineTypeName` (fn pura) | `pipelines/lib/` |
| `statusColumns` (const) | `pipelines/lib/` |
| `stagesToColumns` (fn pura) | `pipelines/lib/` |

**Decisão**: promover os 6 ao barrel `pipelines/index.ts`. Sem mover arquivo.

### Bucket 2 — Hooks (side-effect via Supabase queries)

| Símbolo | De |
|---|---|
| `useCreatePipeWhatsapp` / `useUpdatePipeWhatsapp` | `pipelines/hooks/usePipeWhatsapp` |
| `useCreatePipeConfirmacao` / `useUpdatePipeConfirmacao` / `useDeletePipeConfirmacao` | `pipelines/hooks/usePipeConfirmacao` |
| `useCreatePipeProposta` / `useUpdatePipeProposta` / `useDeletePipeProposta` | `pipelines/hooks/usePipePropostas` |
| `useCreatePipePropostaItem` / `useUpdatePipePropostaItem` / `useDeletePipePropostaItem` | `pipelines/hooks/usePipePropostaItems` |
| `usePipeConfirmacaoByLeadId` / `usePipePropostaByLeadId` | idem |
| `usePipePropostaItems` | idem |
| `usePipelineStages` / `useAllPipelineStageOptions` | `pipelines/hooks/usePipelineStages` |
| `useCustomPipelineStages` | `pipelines/hooks/useCustomPipelines` |
| `useCustomPipelines` | idem |
| `useLossReasons` | `pipelines/hooks/useLossReasons` |
| `useAddLeadToCustomPipe` | `pipelines/hooks/useCustomPipelines` |

**Decisão**: promover todos ao barrel `pipelines/index.ts` agrupados por sub-tema (legacy views, custom, stages, loss reasons).

### Bucket 3 — Components

| Símbolo | De | Destino |
|---|---|---|
| `CompareceuModal` | `pipelines/components/` | promover barrel pipelines |
| `RescheduleModal` | `pipelines/components/` | promover barrel pipelines |

### Bucket 4 — pipelines → leads (9 imports, 3 símbolos)

| Símbolo | De | Destino |
|---|---|---|
| `useTags` | `leads/hooks/` | promover barrel leads |
| `useBulkSelection` | `leads/hooks/` | promover barrel leads |
| `BulkActionBar` | `leads/components/bulk-actions/` | promover barrel leads |

Usado por 3 pages de pipelines (PipeWhatsapp, PipePropostas, PipeConfirmacao).

**Observação semântica**: BulkActionBar + useBulkSelection são UI cross-cutting (não específicos de Lead). Candidatos a movimentação futura pra `shared/components` — **mas fora do escopo desta fase**. Slice 7.3 promove ao barrel `leads/` por enquanto.

## Decisão final — estratégia Slice 7.2

**Não há tipos a extrair pra `shared/`.** Toda movimentação é promoção de exports a barrels existentes + ajuste de imports.

Não precisa Slice 7.2 (mover tipos) separado de Slice 7.3 (hooks/components) — colapsar em 1 PR:

### Slice 7.2 (revisado) — promover ao barrel + atualizar imports (3-5h)

| Tarefa | Detalhe |
|---|---|
| Atualizar `pipelines/index.ts` | Adicionar 29 exports (6 tipos/helpers + 21 hooks + 2 components) |
| Atualizar `leads/index.ts` | Adicionar 3 exports (useTags, useBulkSelection, BulkActionBar) |
| Atualizar 12 arquivos consumers em `leads/` | Trocar `from "@/modules/pipelines/hooks/..."` → `from "@/modules/pipelines"` |
| Atualizar 3 arquivos consumers em `pipelines/` (pages) | Trocar `from "@/modules/leads/hooks/..."` → `from "@/modules/leads"` |
| Validar baseline | `npm run lint:deps:baseline`; ciclo cross-module leads↔pipelines = 0 |
| Smoke | Blocos 2 + 3 do roteiro `smoke-roteiro-sem-whatsapp` |

Antes era 2 slices (7.2 tipos + 7.3 hooks). Agora colapsa em 1 porque inventário mostrou que **nenhum tipo precisa extração pra shared/** — todos podem ficar no módulo de origem desde que promovidos ao barrel.

## Risco residual

**Cuidado com naming conflict no barrel `pipelines/index.ts`** (já tem 68 exports). Promover +29 chega a 97 antes da Fase 8 reduzir. Aceitar — Fase 8 vai cortar.

**`pipelines/index.ts` poderia já adotar sub-pastas (`views/`, `canonical/`, `custom/`)** antes de re-promover, mas isso colapsaria Fase 7 + Fase 8. **NÃO fazer** — manter Fase 7 focada em ciclo, Fase 8 em re-deepen.

## Snapshot pré-Slice-7.2

```
files: leads=156, pipelines=58
exports: leads=48, pipelines=68
deep cross (leads→pipelines): 38
deep cross (pipelines→leads): 9
baseline ratchet violations: 86 (63 no-circular + 23 no-orphans)
```

Snapshot pós-Slice-7.2 esperado:

```
exports: leads=51 (+3), pipelines=97 (+29)
deep cross: 0 + 0 = 0
baseline ratchet: ≤ 80 (estimado — ciclos cross-module entre leads e pipelines deve cair)
```

Verificar após Slice 7.2 mergeado.

## Próximo passo

Slice 7.2 — promoção + ajuste de imports em 1 PR (~3-5h). Branch `feat/arch-deepening/07-2-promote-and-rewire`.
