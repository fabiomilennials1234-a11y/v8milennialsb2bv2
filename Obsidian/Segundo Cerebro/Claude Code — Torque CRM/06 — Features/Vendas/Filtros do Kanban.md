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
| `p_qualification_tier[]` | `leads.qualification_tier::text = ANY` | os 3 |
| `p_pre_qualification_tier[]` | `leads.pre_qualification_tier::text = ANY` (tier da IA) | os 3 |

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
- Painel de filtro (variantes/seções): `src/modules/pipelines/components/kanban/KanbanFilterPanel.tsx`
- Filtro de qualificação (tier): config canônica no barrel `@/modules/leads` (`QUALIFICATION_TIER_CONFIG`/`QUALIFICATION_TIERS`); predicado client `matchesQualificationFilters` em `kanbanFilterParams.ts`; boards bespoke `pages/CustomPipeline.tsx` (+ `components/custom/CustomPipelineKanban.tsx`) e `pages/Negocios.tsx` (+ `carteira/hooks/useDeals.ts`)

## Áreas frágeis (adicional)

🟠 **Deploy acoplado**: o frontend envia os params novos; a migration tem que ir
**primeiro** (ou junto). Frontend novo contra RPC antigo (sem os params) → o
PostgREST não resolve a função → kanban quebra. Ordem: migration → deploy front.

🟠 **Parity client↔SQL**: as bandas (`priorityBandToRating`/`calorBandToBounds`)
e os defaults (`rating||0`, `calor??5`) têm que espelhar o SQL exato, senão o
badge diverge dos cards. Coberto por `tests/unit/kanban-filter-params.test.ts`.

## Funis custom — contagem do badge (2026-07-13)

Os funis **custom** (`custom_pipe_entries` + `custom_pipeline_stages`, hooks
`useCustom*`) têm o mesmo problema de badge que os funis sistema tinham, por uma
causa diferente: `useCustomPipeEntries` busca as entries **sem `.range()`**, então
o PostgREST corta em **1000 rows**. `CustomPipelineKanban` não setava `totalCount`
na coluna → o badge caía em `items.length` (capado em 1000). Funil ativo de import
(ex.: "Prospecção CNAE", etapa "Novo" com 2543+ leads e crescendo) mostrava 1000.

Fix (espelha o board canônico, mas pro modelo custom):
- RPC `public.get_custom_pipeline_stage_counts(p_pipeline_id, p_org_id, p_search)`
  — `COUNT(*) FROM custom_pipe_entries GROUP BY stage_id`, filtrado por
  `pipeline_id` + `organization_id`. `SECURITY INVOKER` + `search_path=''` → RLS
  de `custom_pipe_entries` (via `get_my_organization_ids()`) mantém isolamento
  tenant. Migration `20270314000000_get_custom_pipeline_stage_counts.sql`.
- Hook `useCustomPipeStageCounts(pipelineId, searchQuery)` → `Record<stage_id, count>`.
  Invalidação: as mutations `useAddLeadToCustomPipe`/`useMoveLeadInCustomPipe`/
  `useRemoveLeadFromCustomPipe` invalidam `["custom_pipe_stage_counts", pipelineId]`
  (mesmo padrão que já faziam pra `custom_pipe_entries`).
- `CustomPipelineKanban` seta `totalCount: counts[stage.id] ?? items.length`.

Parity: **sem busca** conta todas as entries por stage (inclusive `lead_id` null),
igual ao comportamento antigo do badge — **exato**. **Com busca** faz LEFT JOIN
`leads` + `ILIKE` em nome/empresa/telefone — **aproximado** (ILIKE não faz strip de
acento NFD como o filtro client). Divergência aceita: o caso reportado é sem busca.

Follow-up conhecido: o board ainda carrega só 1000 **cards** (`useCustomPipeEntries`
não paginado). O badge agora está certo, mas rolar além de 1000 cards exige
paginação/virtualização — fora do escopo deste fix. Ver [[08 — Backlog]].

Onde mexer: migration acima · `src/modules/pipelines/hooks/custom/useCustomPipelines.ts`
(`useCustomPipeStageCounts`) · `src/modules/pipelines/components/custom/CustomPipelineKanban.tsx`.

## Filtro por Qualificação (tier) — todos os 5 boards (2026-07-14)

Dimensão de **visualização** por qualificação, disponível no board de **todos os
pipes**: os 3 sistema (WhatsApp, Confirmação, Propostas) + os 2 bespoke
(CustomPipeline, Negócios). Dois multi-selects: `qualification_tier` (manual) e
`pre_qualification_tier` (IA, 2ª linha). Valores: `diamante, ouro, prata, bronze,
desqualificado`. Vazio = todos (NULL-collapse). Não confundir com as seções
`priority`/`calor` (rating manual) — são dimensões distintas.

Config canônica de tier (labels/ícones/cores + value set) vive no módulo **leads**
(`src/modules/leads/components/lead-detail/modal/qualification-config.tsx` +
`.../types.ts`) e é exposta cross-module via o barrel `@/modules/leads`
(`QUALIFICATION_TIER_CONFIG`, `QUALIFICATION_TIERS`, `type QualificationTier`).
`KanbanFilterPanel` ganhou 2 variantes na union — `qualification-tier` e
`pre-qualification-tier` (checkbox multi-select com ícone/cor do config).

- **3 sistema (server-side)**: params `p_qualification_tier[]` /
  `p_pre_qualification_tier[]` nos 2 RPCs (migration
  `20270714120000_kanban_qualification_tier_filter.sql`, já em prod). Predicado
  **idêntico** nos dois RPCs → badge == cards. Mapeados em `sharedRpcParams`
  (`nonEmpty()`: vazio→null) e incluídos nas queryKeys/deps do
  `usePaginatedPipeline`.
- **2 bespoke (client-side)**: não são paginados no servidor. `CustomPipeline` e
  `Negócios` filtram as entries/deals carregadas com `matchesQualificationFilters`
  (`src/modules/pipelines/lib/kanbanFilterParams.ts`) — predicado byte-a-byte
  equivalente ao SQL (`= ANY`, null nunca casa seleção não-vazia). **A contagem é
  filtrada com a MESMA lógica**: em `CustomPipeline` o badge cai pra `items.length`
  quando `tierFilterActive` (o RPC de count não conhece tier); em `Negócios` a
  lista, os cards e o somatório por coluna derivam todos do mesmo `filteredDeals`.
  `useDeals` passou a selecionar `qualification_tier`/`pre_qualification_tier` no
  join do lead.

## Histórico

- **2026-07-14** — **Filtro de qualificação (tier + pré-qualificação IA) em todos
  os 5 boards.** Config de tier promovida ao barrel `@/modules/leads`. 3 sistema
  server-side (migration `20270714120000`, params idênticos nos 2 RPCs); 2 bespoke
  client-side (cards + contagem filtrados juntos). `types.ts` regenerado de prod.
  Testes: `tests/unit/kanban-qualification-filter.test.ts` (predicado client + parity
  dos params). Seção acima.
- **2026-07-13** — **Badge dos funis custom → count server-side.** Novo RPC
  `get_custom_pipeline_stage_counts` + hook `useCustomPipeStageCounts`; badge deixa
  de travar em 1000. Parity provada contra prod via SQL read-only (Prospecção CNAE,
  "Novo": RPC-equiv == `COUNT(*)` == 2838, ambos > 1000). Detalhes acima.
- **2026-06-30** — **Todos os filtros → server-side.** Contagem do badge agora reflete o filtro (era sempre o total: Perdido=21 mesmo filtrando origem=site→10). `filterItemsLocal` removido das 3 páginas; params genéricos nos 2 RPCs (`20270101000400`). Mappers puros + 12 testes. Verificado contra prod via SQL read-only (origem=site→10, calor default→warm, período CASE). Detalhes: [[2026-06-30]].
- **2026-05-18** — Filtro "Responsável" passa a usar helper único `matchesResponsibleFilter`. Cobre `pre_sale_responsible_id` e `sale_responsible_id` (entry + lead) — campos antes ignorados. Bug original: lead com `pipe_entries.metadata.pre_sale_responsible_id = Bruna` sumia quando ela filtrava por si mesma. Detalhes: [[2026-05-18-kanban-filter-responsible-helper]].
