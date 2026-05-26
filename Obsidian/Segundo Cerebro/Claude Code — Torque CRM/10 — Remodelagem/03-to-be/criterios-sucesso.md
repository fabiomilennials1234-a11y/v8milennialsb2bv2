---
type: reference
title: To-Be — Critérios de Sucesso
status: active
created: 2026-05-26
tags: [remodelagem, to-be, criterios]
related: ["[[estrutura-final]]", "[[principios-modulo]]"]
---

# To-Be — Critérios de Sucesso

Checklist objetivo. Projeto concluído quando todos verdadeiros.

## Estrutura física

- [ ] 0 arquivos no root de `src/components/` (esvaziado, exceto `ui/`, `shared/`, `core/`)
- [ ] 0 hooks soltos em root de `src/hooks/` (todos em `modules/<bc>/hooks/` ou `shared/hooks/`)
- [ ] 0 pages soltas em root de `src/pages/` (todas em `modules/<bc>/pages/`)
- [ ] 0 edge functions soltas no root de `supabase/functions/` (todas em `<bc>/<fn>/`)
- [ ] `supabase/functions/_shared/` root contém só `core/` + subpastas por BC

## Cada módulo

- [ ] `src/modules/<bc>/index.ts` exportando API pública explícita
- [ ] `src/modules/<bc>/CLAUDE.md` com escopo + áreas frágeis + owner
- [ ] Sub-pastas internas não importadas por outros módulos
- [ ] Tests co-located (`Foo.tsx` + `Foo.test.tsx`)

## Tooling

- [ ] `eslint-plugin-boundaries` instalado + configurado
- [ ] `dependency-cruiser` instalado + configurado
- [ ] CI gate ativo (PR falha em violação de boundary ou ciclo)
- [ ] ESLint `boundaries` em **error mode** (não warn-only)

## Event-bus (slice 19 piloto)

- [ ] Migration `domain_events` aplicada em dev
- [ ] `_shared/events/{types,publish,dispatch,registry}.ts` implementados
- [ ] Edge `event-dispatcher` deployado + cron `*/1 * * * *` ativo
- [ ] `triggerStageChangedWorkflows` chamado em **1 só lugar** (handler do evento)
- [ ] Drag lead no kanban → evento publicado → workflow dispara em <2s
- [ ] Idempotência: re-processar mesmo evento não duplica execução
- [ ] Sentry breadcrumb com `event.type` em cada publish
- [ ] Backlog `triggerStageChangedWorkflows-duplicate.md` fechado

## Dedup absorvido

- [ ] `useLeadHistory` + `useLeadTimeline` + `useFieldChangelog` + `useFieldChanges` consolidados (slice 03)
- [ ] `useCopilotToggle*` (3) → 1 composable (slice 06)
- [ ] `useRealtimeChannel*` (3) → só `useRealtimeSubscription` exportado (slice 05)
- [ ] `_shared/auth.ts` vs `user-auth.ts` consolidados (slice 16)
- [ ] `_shared/actions/` vs `action-handlers/` consolidados (slice 07)
- [ ] Webhooks ambíguos auditados + decididos (`lead-webhook` vs `webhook-new-lead`, `webhook-calcom` vs `meeting-webhook`, `tinyerp-webhook` vs `erp-order-webhook`)
- [ ] Pages órfãs (`MockupChat*`) deletadas ou movidas (slice 5)
- [ ] Edge functions test/dev (`test-copilot-chat`, `test-workflow-system`, `webhook-send-test`) deletadas ou movidas pra `tests/`

## Documentação

- [ ] `CLAUDE.md` raiz atualizado refletindo nova estrutura
- [ ] `AGENTS.md` raiz atualizado
- [ ] `llms.txt` raiz atualizado
- [ ] Vault Obsidian `02 — Arquitetura/Modulos.md` atualizado com 14 módulos
- [ ] Vault `10 — Remodelagem` marcado como `status: concluido` no MOC
- [ ] ADR de conclusão criado em `04 — Decisões/`

## Qualidade

- [ ] CI verde (lint + typecheck + unit + integration + e2e)
- [ ] Bundle size delta ±5% (não regrediu)
- [ ] Smoke manual: login → kanban → chat → copilot → workflow → campaign → carteira → analytics
- [ ] Sentry sem aumento de error rate na semana pós-merge

## Não-regressão

- [ ] Comportamento idêntico antes/depois (zero feature nova)
- [ ] Zero pixel modificado (zero mudança visual)
- [ ] Zero schema DB modificado
- [ ] Zero mudança de provider/integração

## Refs

- [[estrutura-final]] — layout target
- [[principios-modulo]] — regras
- SPEC: `.specs/features/modularizacao/SPEC.md` (critérios completos)
- ADR: [[ADR-2026-05-26-modularizacao-monolito-modular]]
