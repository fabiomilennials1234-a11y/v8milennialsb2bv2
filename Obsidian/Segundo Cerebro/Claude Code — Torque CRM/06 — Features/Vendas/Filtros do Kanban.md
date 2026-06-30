---
type: feature
domain: vendas
tags: [pipelines, kanban, filtros, multi-tenancy-ui]
---

# Filtros do Kanban

## O que é

Painel de filtros (`KanbanFilterPanel`) presente nos 3 funis sistema — WhatsApp, Confirmação e Propostas. Permite ao usuário filtrar cards por Responsável, Origem, Tags, Agendados, etc. **Display-only**: relaxa ou esconde rows que o RLS já liberou. Não é mecanismo de autorização.

## Como funciona

**Desde 2026-06-30 todos os filtros são resolvidos server-side.** As 3 páginas
(`src/modules/pipelines/pages/{PipeWhatsapp,PipeConfirmacao,PipePropostas}.tsx`)
usam `usePaginatedPipeline(slug, stages, filters)`
(`src/modules/pipelines/hooks/model/usePaginatedPipeline.ts`), que envia os
filtros pros 2 RPCs `get_pipeline_page` (cards paginados/etapa) e
`get_pipeline_stage_counts` (contagem do badge). **Mesma query filtrada alimenta
cards e contagem → o badge da coluna sempre bate com o que está visível.**

Antes, só search/responsável/tags iam server-side; origem, período, agendado,
urgência, calor, prioridade, time-bucket e status rodavam client-side num
closure `filterItemsLocal` **depois da paginação** — então o badge mostrava o
total não-filtrado (ex.: Perdido=21 mesmo com origem=site → 10 cards) e o filtro
client só enxergava a página carregada (20/etapa). Esse closure foi removido.

### Contrato dos params genéricos

A página traduz a sua UI (bandas/buckets/timezone) em params genéricos; o RPC só
aplica predicados SQL simples. Param `NULL` = filtro desligado (curto-circuita,
custo zero quando inativo). Defaults espelham o client: `COALESCE(rating,0)`,
`COALESCE(metadata.calor,5)`.

| Param | Predicado | Usado por |
|---|---|---|
| `p_origins[]` | `leads.origin::text = ANY` | os 3 |
| `p_rating_min/max` | banda de prioridade (`rating`) | propostas |
| `p_calor_min/max` | banda de calor (`metadata.calor`) | propostas |
| `p_urgency` | `leads.urgency` | confirmação |
| `p_product_type` | `metadata.product_type` | propostas |
| `p_meeting_after/before` | `metadata.meeting_date` range | confirmação (today/tomorrow/week) |
| `p_period_after/before` + `p_closed_status_keys` | data status-dependente (closed → metrics_period_at/updated_at; open → created_at) | os 3 (propostas usa closed keys) |
| `p_updated_before` + `p_overdue_exclude_status_keys` | overdue (stale + ≠ compareceu/perdido) | confirmação |
| `p_status_keys[]` | `stage_key = ANY` | confirmação (status multi) |
| `p_scheduled` | EXISTS `scheduled_user_messages` status='scheduled' | os 3 |

Mappers puros de banda: `src/modules/pipelines/lib/kanbanFilterParams.ts`
(`priorityBandToRating`, `calorBandToBounds` + constantes de status).

Dados ainda chegam projetados pelo `flattenMetadata`
(`src/modules/pipelines/hooks/model/usePipelineEntries.ts`), que joga os campos
do `pipeline_entries.metadata` JSON pro nível raiz do item.

## Contrato — filtro "Responsável"

Implementação compartilhada em `src/lib/kanban-filters.ts`:

```ts
matchesResponsibleFilter(item, filterId): boolean
```

- `filterId === "all"` (ou `null`/`""`/`undefined`) → sempre `true`.
- Caso contrário, retorna `true` se `filterId` bate em **qualquer** um dos campos abaixo, comparando só valores não-nulos:

  | Origem | Campos checados |
  |---|---|
  | `item` (entry) | `responsible_id`, `sdr_id`, `pre_sale_responsible_id`, `sale_responsible_id` |
  | `item.lead`    | `responsible_id`, `sdr_id`, `closer_id`, `pre_sale_responsible_id`, `sale_responsible_id` |

- `closer_id` é lido **só** do lead — `flattenMetadata` não popula `closer_id` no entry.
- `filterId` é um `team_members.id` (dropdown serve `useResponsibleMembers()`).

## Regras de negócio

- O dropdown é **auto-escopado pra member**: em Confirmação e Propostas, na primeira renderização, se `selectedResponsibleId === "all"` e o usuário tem role `membro`, o filtro é setado pro próprio `team_member.id` automaticamente. Lógica em `membroDefaultApplied` nos dois `useEffect`s. PipeWhatsapp não faz auto-scope (filtro persiste em localStorage e default é `"all"`).
- O filtro é display-only. Auth é do RLS.
- O helper é puro (sem React, sem deps externas). Testar via vitest.

## Edge cases

- **Entry sem lead** (ghost row, RLS bloqueou o join): tratado antes do filtro pelo `filterItems(item).lead == null` — entry é descartado, não chega no helper.
- **Lead com todos os campos null + filterId real**: retorna `false`. O lead literalmente não é responsabilidade de ninguém — fica no bucket "sem responsável" se for visualizado pelo dropdown `all`.
- **Filter pra membro só presente em `pre_sale_responsible_id`**: agora bate (era o bug original — Alessandra Pinheiro / Bruna).
- **Item null** (defensivo): retorna `false` exceto se `filterId === "all"`.

## Áreas frágeis

🟠 **Multi-tenancy / permissões**: filtro é display-only. RLS continua sendo a fonte da verdade. Não dependa do filtro pra autorização. Se um membro vê uma row e não devia, é bug de RLS — não de filtro.

## Onde mexer

- RPCs: `supabase/migrations/20270101000400_kanban_filters_server_side.sql` (`get_pipeline_page`, `get_pipeline_stage_counts`)
- Hook: `src/modules/pipelines/hooks/model/usePaginatedPipeline.ts` (`PaginatedFilters`, `sharedRpcParams`)
- Mappers de banda: `src/modules/pipelines/lib/kanbanFilterParams.ts` + `tests/unit/kanban-filter-params.test.ts`
- Pipes: `src/modules/pipelines/pages/{PipeWhatsapp,PipeConfirmacao,PipePropostas}.tsx` (objeto `filters` passado ao hook)
- Shape do entry: `src/modules/pipelines/hooks/model/usePipelineEntries.ts` — `flattenMetadata`

## Áreas frágeis (adicional)

🟠 **Deploy acoplado**: o frontend envia os params novos; a migration tem que ir
**primeiro** (ou junto). Frontend novo contra RPC antigo (sem os params) → o
PostgREST não resolve a função → kanban quebra. Ordem: migration → deploy front.

🟠 **Parity client↔SQL**: as bandas (`priorityBandToRating`/`calorBandToBounds`)
e os defaults (`rating||0`, `calor??5`) têm que espelhar o SQL exato, senão o
badge diverge dos cards. Coberto por `tests/unit/kanban-filter-params.test.ts`.

## Histórico

- **2026-06-30** — **Todos os filtros → server-side.** Contagem do badge agora reflete o filtro (era sempre o total: Perdido=21 mesmo filtrando origem=site→10). `filterItemsLocal` removido das 3 páginas; params genéricos nos 2 RPCs (`20270101000400`). Mappers puros + 12 testes. Verificado contra prod via SQL read-only (origem=site→10, calor default→warm, período CASE). Detalhes: [[2026-06-30]].
- **2026-05-18** — Filtro "Responsável" passa a usar helper único `matchesResponsibleFilter`. Cobre `pre_sale_responsible_id` e `sale_responsible_id` (entry + lead) — campos antes ignorados. Bug original: lead com `pipe_entries.metadata.pre_sale_responsible_id = Bruna` sumia quando ela filtrava por si mesma. Detalhes: [[2026-05-18-kanban-filter-responsible-helper]].
