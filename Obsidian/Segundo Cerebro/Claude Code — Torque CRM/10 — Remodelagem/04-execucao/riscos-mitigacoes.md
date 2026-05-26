---
type: reference
title: Execução — Riscos e Mitigações
status: active
created: 2026-05-26
tags: [remodelagem, execucao, riscos]
related: ["[[slices]]"]
---

# Execução — Riscos e Mitigações

| Risco | Mitigação |
|-------|-----------|
| **Imports massivos a reescrever** | Codemod (jscodeshift) por slice. Cada slice = 1 codemod scriptado, reversível. |
| **Conflict storm em PRs paralelos** | Slices sequenciais por padrão. Paralelismo só entre slices que tocam módulos sem deps (raro). Disciplina firmada: `feedback_branch_discipline_during_feature.md`. |
| **Hotfix durante feature longa** | Protocolo já firmado (`feedback_hotfix_during_feature.md`): sai de `main`, merge `main→develop`, rebase slices em andamento. |
| **Deploy edge functions quebra** | Slice 14 isolado: muda paths + deploy scripts no mesmo PR, testa em dev antes de prod. CI roda smoke deploy em dev. |
| **Realtime subscriptions invalidam cache errado** | Validar `queryKey` por hook movido. Hooks de realtime listados em `_shared/realtime/` ou no módulo dono. |
| **AI subagentes perdidos durante transição** | Sub-CLAUDE.md por módulo criado no skeleton (slice 2). Vault atualizado em slice 17 + branch nova `10 — Remodelagem` (este). |
| **Pasta `MockupChat*` órfã** | Slice 5 (communication): deletar se confirmado órfão, ou mover pra `modules/communication/internal/mockups/` se ainda referenciada. |
| **Disciplina de PRs** | Regra já firmada: só `feat/modularizacao/*` ou `hotfix/*` ou `chore/*` durante feature. Sem outras branches paralelas. |
| **CI baseline red** | Memory `project_ci_baseline_red.md`: main estava red antes do redesign do modal. Falhas pré-existentes em workflow-executor-branches, lead-service-branches, auth-context. Avaliar se modularização pode estabilizar (ou se precisa fix prévio). |
| **Bundle size regrediu >5%** | CI mede bundle size. Slice 17 (docs) valida delta. Causa provável de regressão: duplicação acidental de export em `index.ts`. |
| **Event-bus dispatcher cron parar** | Alarme em `domain_events.processed_at < now() - 30s` count. Sentry alert. Backfill manual reseta `processed_at`. |
| **Idempotência de handlers (event-bus)** | Handler precisa ser idempotente. Doc em [[event-bus]]. Tests específicos por handler. |
| **Pipe legacy vs novo dual model** | Memory `reference_pipe_views_compat.md`: pipe_* são views compat. Slice 04 NÃO faz unificação modelo (out-of-scope). Apenas isola namespace. Cleanup futuro = projeto separado. |
| **Squash-merge dropando diff em stack** | Memory `feedback_squash_stacked_prs.md`: rebase + retarget base pra main antes de squash. Não aplicável aqui (slices vão pra develop, não stack). |
| **`git clean` apagar untracked legítimo** | Memory `feedback_git_clean_safety.md`: sempre dry-run `-fdn` antes de `-fd`. |
| **Push em branch errada** | Memory `feedback_push_new_branch.md`: todo push em branch nova nomeada pelo slice. Nunca push direto em develop/main. |

## Não-riscos (avaliados e descartados)

- **Microsserviços parciais durante transição**: não. Modularização não introduz comunicação via rede. Tudo continua in-process até event-bus piloto (slice 19), que usa DB-backed queue (não HTTP).
- **Migrações de schema**: zero. Out-of-scope.
- **Mudança visual**: zero. Out-of-scope.
- **Refactor de regras de negócio**: zero. Out-of-scope.

## Refs

- [[slices]] — ordem de execução
- ADR: [[ADR-2026-05-26-modularizacao-monolito-modular]]
- Memories relevantes:
  - `feedback_branch_discipline_during_feature.md`
  - `feedback_hotfix_during_feature.md`
  - `feedback_push_new_branch.md`
  - `feedback_git_clean_safety.md`
  - `feedback_squash_stacked_prs.md`
  - `project_ci_baseline_red.md`
  - `reference_pipe_views_compat.md`
