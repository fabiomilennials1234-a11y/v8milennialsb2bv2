---
type: changelog
date: 2026-07-14
domain: vendas
tags: [pipelines, kanban, filtros, qualificacao]
---

# 2026-07-14 — Filtro de qualificação (tier) no Kanban de todos os pipes

## Mudanças

- **Kanban filtros**: nova dimensão de **visualização** por qualificação —
  `qualification_tier` (manual) + `pre_qualification_tier` (IA, 2ª linha) — no
  board de **todos os 5 pipes**: WhatsApp, Confirmação, Propostas (server-side),
  CustomPipeline e Negócios (client-side). Valores: `diamante, ouro, prata,
  bronze, desqualificado`. Vazio = todos. Não mexe em priority/calor (rating).
- **leads (barrel)**: `QUALIFICATION_TIER_CONFIG`, `QUALIFICATION_TIERS` e o type
  `QualificationTier` agora saem por `@/modules/leads` — fonte única de
  labels/ícones/cores, consumida cross-module pelos filtros do Kanban (boundaries
  error mode exige barrel).
- **types.ts**: regenerado de prod (`jsjsmuncfkbsbzqzqhfq`) — `get_pipeline_page`
  e `get_pipeline_stage_counts` agora expõem `p_qualification_tier` /
  `p_pre_qualification_tier`.

## Arquivos tocados

- `src/modules/leads/index.ts` — export da config de tier + type + lista.
- `src/modules/pipelines/lib/kanbanFilterParams.ts` — `matchesTierFilter` +
  `matchesQualificationFilters` (predicado client, parity com o SQL `= ANY`).
- `src/modules/pipelines/hooks/model/usePaginatedPipeline.ts` — `PaginatedFilters`
  ganha `qualificationTier`/`preQualificationTier`; `sharedRpcParams` mapeia pros
  `p_*` com `nonEmpty()` (vazio→null); ambos entram nas queryKeys/deps. Função
  `sharedRpcParams` exportada para teste.
- `src/modules/pipelines/components/kanban/KanbanFilterPanel.tsx` — 2 variantes na
  union (`qualification-tier`, `pre-qualification-tier`) + os 4 pontos de toque
  (union, countActiveFilters, getFilterChips, SectionRenderer) + `TierCheckboxList`.
- `src/modules/pipelines/pages/{PipeWhatsapp,PipeConfirmacao,PipePropostas}.tsx` —
  estado persistido dos 2 tiers, setters, injeção das seções, clear-all e mapeamento
  pro hook.
- `src/modules/pipelines/pages/CustomPipeline.tsx` +
  `src/modules/pipelines/components/custom/CustomPipelineKanban.tsx` — filtro
  client-side sobre as entries; `tierFilterActive` faz o badge cair pra
  `items.length` (o RPC de count não conhece tier).
- `src/modules/pipelines/pages/Negocios.tsx` +
  `src/modules/carteira/hooks/useDeals.ts` — join do lead passa a trazer os tiers;
  filtro client-side sobre `deals` alimenta lista + kanban (mesma fonte → consistente).
- `src/contracts/pipe/pipe-entities.ts` — `CustomPipeEntry.lead` ganha os 2 campos
  de tier (já eram selecionados na query).
- `tests/unit/kanban-qualification-filter.test.ts` — predicado client + parity dos
  params (vazio→null, pass-through, dimensões independentes).
- `supabase/migrations/20270714120000_kanban_qualification_tier_filter.sql` — já
  em prod (predicado idêntico nos 2 RPCs; validado por sonda: badge==cards).

## Decisões

- **Server vs client por board**: os 3 sistema resolvem no RPC (predicado idêntico
  nos 2 → badge==cards por construção); os 2 bespoke não são paginados no servidor,
  então filtram cards **e** contagem client-side com a MESMA função. Nunca filtrar
  só um dos dois.
- **Config de tier no módulo leads**: reusar `QUALIFICATION_TIER_CONFIG` em vez de
  duplicar. O `TIER_OPTIONS` do Disparo (`AudienceConditionsControls`) passou a
  **derivar** do config canônico (mesmo shape/ordem `{value,label}` → consumidores
  intactos).

## Follow-ups

- CustomPipeline ainda carrega só 1000 cards (`useCustomPipeEntries` sem paginação);
  sob filtro de tier a contagem client reflete só o carregado. Mesmo débito já
  registrado no badge custom (2026-07-13).
- Deploy: migration já em prod; falta só o deploy do front.
