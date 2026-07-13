---
type: backlog
title: Funis custom — paginação/virtualização dos cards (cap 1000)
status: backlog
created: 2026-07-13
updated: 2026-07-13
tags: [pipelines, kanban, custom-pipes, performance]
related: ["[[Filtros do Kanban]]"]
owner: gabriel
---

# Funis custom — paginação/virtualização dos cards (cap 1000)

## Problema

`useCustomPipeEntries` (`src/modules/pipelines/hooks/custom/useCustomPipelines.ts`)
busca **todas** as entries de um funil custom **sem `.range()`** → o PostgREST
corta em **1000 rows**. Em funis grandes (ex.: "Prospecção CNAE" com 2800+ leads
na etapa "Novo") o board renderiza no máximo 1000 **cards**, mesmo que o total
seja maior.

O **badge da contagem já foi corrigido** (2026-07-13, RPC
`get_custom_pipeline_stage_counts` + `useCustomPipeStageCounts`) e mostra o total
real. Falta corrigir o **carregamento dos cards** em si.

## Solução proposta

Espelhar o board canônico (`usePaginatedPipeline` + `get_pipeline_page`):
- Loader paginado por stage (cursor por `created_at`, `p_page_size`).
- "Carregar mais" / virtualização por coluna no `DraggableKanbanBoard`
  (`hasMore`/`onLoadMore`/`isFetchingMore` já existem na interface `KanbanColumn`).
- RPC `get_custom_pipeline_page(p_pipeline_id, p_stage_id, p_org_id, p_cursor, ...)`
  análogo ao `get_pipeline_page`, `SECURITY INVOKER` + `search_path=''`.

## Critérios de aceite

- Funil custom com >1000 leads numa etapa carrega os cards além de 1000
  (scroll/paginação), sem cortar.
- Badge continua batendo com o total real (já resolvido).
- RLS preservada (SECURITY INVOKER, filtra `organization_id`).
- Sem regressão de perf em funis pequenos (curto-circuita quando `< page_size`).

## Origem

Follow-up conhecido do fix do badge custom (2026-07-13) — ver [[Filtros do Kanban]]
seção "Funis custom — contagem do badge". O fix do badge foi cirúrgico e
deliberadamente NÃO levantou o cap de 1000 cards.
