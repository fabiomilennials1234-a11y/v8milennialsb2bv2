---
type: adr
title: "Erro é contrato; o Sentry volta para observar exceção"
status: draft
created: 2026-09-30
updated: 2026-09-30
tags: [adr, observabilidade, erros, sentry, lgpd, ux]
related: []
owner: gabriel
supersedes: []
superseded_by: []
---

# ADR-2026-09-30: Erro é contrato; o Sentry volta para observar exceção

**Data:** 2026-09-30
**Status:** draft (proposto ao CTO em 2026-09-30)
**Fonte canônica:** `docs/adr/0038-erro-e-contrato-e-o-sentry-observa-excecao.md` (este espelho resume; o repo decide)
**Plano:** `.specs/features/erros-e-observabilidade/SPEC.md` (fatias S0–S7)
**Relações:** substitui as decisões 1 e 3 do ADR-0017 (Sentry fora; erro do cliente só no anel do Chamado). Reescopa o PRD #805.

## Contexto

Erro no Torque é texto solto. O cliente vê Postgres em inglês ou um genérico; a gente só sabe que
quebrou quando ele avisa. Medido em 2026-09-30:

- ~268 sítios jogam `err.message` no toast; 118 usam `instanceof Error ? .message`, que apaga erro do Supabase.
- 24 dos 25 Chamados de 30 dias chegaram com erro de front anexado: o erro existia e ninguém viu.
- Exceção não tratada de edge function vai só para `console.error`, não para `runtime_logs`.
- `system_alerts`: 19.692 `critical` de cron em 30 dias, 0 resolvidos. Falha isolada de ~0,7% vira alerta crítico.
- Source map público em prod (7,3 MB de código-fonte).

## Decisão

1. Todo erro vira `AppError { code, userMessage (PT), action, reference, retryable, cause }`. Texto técnico nunca vai para a tela.
2. Um ponto de passagem por lado (front: `toAppError`/`notifyError`/caches/boundary; edge: `withErrorBoundary`). Lint trava o padrão antigo.
3. Sentry para exceção (front + edge); `runtime_logs` para o domínio. Ponte por `session_id`/`request_id`.
4. PII: região EU, sem PII por padrão, `beforeSend` como fronteira de LGPD, replay só em erro e mascarado, identidade só UUID.
5. Source map `hidden`, enviado ao Sentry e fora do nginx.
6. Alerta é sobre mudança de estado (novo, regressão, pico), com dono e rotina semanal.
7. Começa no plano grátis; vai para o Team quando o dev júnior entrar ou a cota estourar.

## Por que não o in-house

Agrupamento, symbolication, breadcrumbs, regras de alerta, release health: meses de trabalho para
um time de 2 chegar a um Sentry pior. O ADR-0017 perdeu o Sentry por falha de processo (ninguém lia),
e o `system_alerts` mostra que o in-house sofre da mesma doença.
