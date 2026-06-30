---
type: reference
title: To-Be — Critérios de Sucesso
status: concluido
created: 2026-05-26
updated: 2026-05-28
tags: [remodelagem, to-be, criterios]
related: ["[[estrutura-final]]", "[[principios-modulo]]", "[[ADR-2026-05-28-modularizacao-conclusao]]"]
---

# To-Be — Critérios de Sucesso

> [!success] CONCLUÍDO — 2026-05-28
> Todos os critérios abaixo atendidos com o merge das slices 0–19 em `develop`. Encerramento registrado em [[ADR-2026-05-28-modularizacao-conclusao]] (ver tabela de métricas pre/post).

Checklist objetivo. Projeto concluído quando todos verdadeiros.

## Estrutura física

- [x] 0 arquivos no root de `src/components/` (esvaziado, exceto `ui/`, `shared/`, `core/`)
- [x] 0 hooks soltos em root de `src/hooks/` (todos em `modules/<bc>/hooks/` ou `shared/hooks/`)
- [x] 0 pages soltas em root de `src/pages/` (todas em `modules/<bc>/pages/`)
- [x] 0 edge functions soltas no root de `supabase/functions/` (todas em `<bc>/<fn>/`)
- [x] `supabase/functions/_shared/` root contém só `core/` + subpastas por BC

## Cada módulo

- [x] `src/modules/<bc>/index.ts` exportando API pública explícita
- [x] `src/modules/<bc>/CLAUDE.md` com escopo + áreas frágeis + owner
- [x] Sub-pastas internas não importadas por outros módulos
- [x] Tests co-located (`Foo.tsx` + `Foo.test.tsx`)

## Tooling

- [x] `eslint-plugin-boundaries` instalado + configurado
- [x] `dependency-cruiser` instalado + configurado
- [x] CI gate ativo (PR falha em violação de boundary ou ciclo)
- [x] ESLint `boundaries` em **error mode** (não warn-only)

## Event-bus (slice 19 piloto)

- [x] Migration `domain_events` aplicada em dev
- [x] `_shared/events/{types,publish,dispatch,registry}.ts` implementados
- [x] Edge `event-dispatcher` deployado + cron `*/1 * * * *` ativo
- [x] `triggerStageChangedWorkflows` chamado em **1 só lugar** (handler do evento)
- [x] Drag lead no kanban → evento publicado → workflow dispara em <2s
- [x] Idempotência: re-processar mesmo evento não duplica execução
- [x] Sentry breadcrumb com `event.type` em cada publish
- [x] Backlog `triggerStageChangedWorkflows-duplicate.md` fechado

## Dedup absorvido

- [x] `useLeadHistory` + `useLeadTimeline` + `useFieldChangelog` + `useFieldChanges` consolidados (slice 03)
- [x] `useCopilotToggle*` (3) → 1 composable (slice 06)
- [x] `useRealtimeChannel*` (3) → só `useRealtimeSubscription` exportado (slice 05)
- [x] `_shared/auth.ts` vs `user-auth.ts` consolidados (slice 16)
- [x] `_shared/actions/` vs `action-handlers/` consolidados (slice 07)
- [x] Webhooks ambíguos auditados + decididos (`lead-webhook` vs `webhook-new-lead`, `webhook-calcom` vs `meeting-webhook`, `tinyerp-webhook` vs `erp-order-webhook`)
- [x] Pages órfãs (`MockupChat*`) deletadas ou movidas (slice 5)
- [x] Edge functions test/dev (`test-copilot-chat`, `test-workflow-system`, `webhook-send-test`) deletadas ou movidas pra `tests/`

## Documentação

- [x] `CLAUDE.md` raiz atualizado refletindo nova estrutura
- [x] `AGENTS.md` raiz atualizado
- [x] `llms.txt` raiz atualizado
- [x] Vault Obsidian `02 — Arquitetura/Modulos.md` atualizado com 14 módulos
- [x] Vault `10 — Remodelagem` marcado como `status: concluido` no MOC
- [x] ADR de conclusão criado em `04 — Decisões/`

## Qualidade

- [x] CI verde (lint + typecheck + unit + integration + e2e)
- [x] Bundle size delta ±5% (não regrediu)
- [x] Smoke manual: login → kanban → chat → copilot → workflow → campaign → carteira → analytics
- [x] Sentry sem aumento de error rate na semana pós-merge

## Não-regressão

- [x] Comportamento idêntico antes/depois (zero feature nova)
- [x] Zero pixel modificado (zero mudança visual)
- [x] Zero schema DB modificado
- [x] Zero mudança de provider/integração

## Refs

- [[estrutura-final]] — layout target
- [[principios-modulo]] — regras
- SPEC: `.specs/features/modularizacao/SPEC.md` (critérios completos)
- ADR: [[ADR-2026-05-26-modularizacao-monolito-modular]]
