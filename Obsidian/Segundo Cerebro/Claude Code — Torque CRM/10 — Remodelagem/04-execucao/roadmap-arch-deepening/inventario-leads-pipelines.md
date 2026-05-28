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

~~Slice 7.2 — promoção + ajuste de imports em 1 PR (~3-5h). Branch `feat/arch-deepening/07-2-promote-and-rewire`.~~

**Slice 7.2 original INVALIDADA em 2026-05-28.** Ver seção abaixo.

---

## Slice 7.2 — tentativa invalidada (2026-05-28)

### O que foi feito

Branch `feat/arch-deepening/07-2-promote-and-rewire` (local, nunca pushada, **deletada**) executou exatamente o que o inventário pediu:

- `pipelines/index.ts`: +6 hooks + 3 `statusColumns` aliased (resolve colisão entre 3 hooks legacy)
- `leads/index.ts`: +3 (`useTags`, `useBulkSelection`, `BulkActionBar`)
- 18 consumers reescritos (15 em `leads/`, 3 em `pipelines/`)
- Verificação `grep` cross-module: **0 deep imports** leads ↔ pipelines

### O que quebrou

```
baseline ratchet: 86 → 120 violations
  no-circular: 63 → 97 (+34 NEW)
  no-orphans: 23 → 23
```

Constraint invariante do CTO: **"baseline SEMPRE verde. Se subir, abortar."** Abortado.

### Por que a premissa estava errada

Inventário previu **queda** para ≤80. Realidade: **subiu 39%**.

Causa: barrel-to-barrel cria um ciclo mais largo, não menor.

- **Antes** (deep imports): `leads/X.tsx → pipelines/hooks/Y.ts` — grafo file-to-file fino. Ciclos curtos, localizados.
- **Depois** (barrel): `leads/X.tsx → pipelines/index.ts` (re-exporta 97 símbolos, incluindo `KanbanCard` que importa `leads/index.ts` (51 símbolos)) `→ ... → leads/X.tsx`. Cada import via barrel materializa o ciclo cross-module na sua plenitude.

**O ciclo é REAL no domínio.** Não é artefato de organização de arquivos:
- `leads` precisa mutar pipes (`LeadModal`, `LeadCreateForm`, `ConfirmacaoContext`, `PropostasContext`, `MeetingFieldBlock`, `BudgetFieldBlock` criam/atualizam pipe_*)
- `pipelines` precisa ler leads (`KanbanCard`, `PipeTableView`, pages consomem tags/bulk-select)

Promoção ao barrel só **renomeia** o problema — não trata coupling estrutural.

### Lição

Slice "mecânica" (mover símbolos para barrels) sem análise de coupling de domínio = trabalho perdido. Inventário 7.1 mediu deep imports mas não mediu **direção semântica** (mutation vs read) nem **handler topology** (quem é entry point, quem é folha).

---

## Replan — Slice 7 reescrita (2026-05-28)

### Slice 7.2-bis — inversão via event-bus existente (~2-3 dias)

**Alvo:** matar `leads → pipelines/hooks/*` (38 imports) substituindo por publicação de evento.

Event-bus já operacional (slice 19 piloto: `lead.stage_changed`). Expandir vocabulário:

| Evento novo | Publisher (em `leads/`) | Subscriber (em `pipelines/`) |
|---|---|---|
| `pipe.add` | LeadModal, LeadCreateForm, MeetingFieldBlock, BudgetFieldBlock | handler executa `useCreatePipe*` |
| `pipe.stage.change` | ConfirmacaoContext, PropostasContext, WhatsAppContext | handler executa `useUpdatePipe*` |
| `pipe.remove` | CrossPipePanel, useLeadPipeHandlers | handler executa `useDeletePipe*` |
| `pipe.proposta.item.upsert` | BudgetFieldBlock | handler executa items mutations |

**Critério de sucesso:** zero hook `usePipe*` chamado de dentro de `leads/`. Só tipos remanescentes (via `import type`).

Estimativa restante de `leads → pipelines` após 7.2-bis: ~5 imports type-only.

### Slice 7.3-bis — re-deepen pipelines barrel (~1 dia)

**Problema atual:** `pipelines/index.ts` re-exporta 97 símbolos. Qualquer barrel-to-barrel arrasta tudo.

**Solução:** quebrar em sub-barrels semânticos:

```
pipelines/
├── views/index.ts       # pipe_whatsapp/confirmacao/propostas hooks + types
├── canonical/index.ts   # pipeline_entries + pipeline_stages (modelo novo)
├── custom/index.ts      # custom_pipelines + members
├── kanban/index.ts      # KanbanCard, KanbanBoard, etc — consome lead TYPES (não índice)
├── legacy/index.ts      # CompareceuModal, RescheduleModal, etc
└── index.ts             # re-exporta só os sub-barrels (fica pequeno)
```

Consumers escolhem o sub-barrel: `import { KanbanCard } from "@/modules/pipelines/kanban"` — não puxa `pipe_whatsapp` hooks.

Quebra ciclo dep-cruiser porque `pipelines/kanban → leads/index.ts` não passa mais por `pipelines/index.ts → leads/index.ts → pipelines/index.ts`.

### Slice 7.4-bis — type-only imports onde sobrar (~2 horas)

`import type { Lead }` não gera runtime cycle (TS-only, apagado em build). Marcar qualquer remanescente cross-module como type-only.

### Net result projetado (validar após 7.2-bis + 7.3-bis)

- Deep cross-module: 0
- Baseline ratchet: estimativa **~70** (queda real, não chutada) — confirmar via medição pós-7.2-bis
- Domain shape: pipelines = side-effect handler. leads = command publisher.

### Riscos

- Event-bus async exige `wait_response` no UI onde antes era await direto (mutation chain quebra)
- Realtime + event sequencing — testar concorrência
- Permission gates (`useLeadActionGates`) precisam funcionar antes do publish

### Ordem proposta

1. **7.2-bis** primeiro (inverte 38 imports leads→pipelines) — quebra 80% do ciclo
2. **7.3-bis** depois (sub-barrels) — quebra os 9 imports pipelines→leads + reduz baseline
3. **7.4-bis** finaliza — type-only para resto

Fase 8 (re-deepen pipelines geral) cancelada — 7.3-bis cobre.

### Pré-requisitos pra 7.2-bis

Antes de codar, mapear:

- [ ] Listar 38 deep imports `leads → pipelines` por categoria: **mutation** (publica evento) vs **read** (consome tipo)
- [ ] Para reads de tipo: marcar como `import type` candidato em 7.4-bis
- [ ] Para mutations: definir contrato exato do evento (payload, response shape)
- [ ] Confirmar event-bus suporta request-response sync (mutation chains com toast/error feedback) — se não, criar wrapper
- [ ] Decidir: 1 PR grande (todos os 4 contextos migrados) vs 4 PRs incrementais (1 por evento)

Branch base: `feat/arch-deepening/07-2-bis-eventbus-inversion` (a criar quando 7.2-bis começar).
