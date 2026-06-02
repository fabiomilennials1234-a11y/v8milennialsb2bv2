---
type: backlog
title: "Permissions fallback — converter `allowed: true` para fail-closed"
status: backlog
created: 2026-04-12
updated: 2026-04-12
tags: [uncategorized]
related: []
owner: gabriel
---

# Permissions fallback — converter `allowed: true` para fail-closed

## Problema

`src/lib/permissions.ts` contém paths que retornam fallback `{ allowed: true }` em casos de erro/loading (linhas aproximadas 140 e 207). Isso viola a doutrina de fail-closed-por-padrão estabelecida pelo Security.

Em casos como erro de rede no RPC `check_action_allowed`, ou enquanto a permission ainda está carregando, o hook deve **bloquear** por padrão e deixar o caller decidir UX (spinner, retry, mensagem).

## Tarefas

- [ ] Auditar todos os call sites de `useCanPerformAction` e `useCanPerformActionAsync`.
- [ ] Identificar quais path retornam `allowed: true` como fallback.
- [ ] Converter para `allowed: false` (default deny).
- [ ] Verificar se algum consumer assume `allowed === true` em loading e ajustar UX (spinner, disable).
- [ ] Adicionar testes unit para todos os paths de erro/loading retornando `allowed: false`.
- [x] Mirror em `supabase/functions/_shared/permission_engine.ts` se houver paths similares. **(#647, 2026-06-01)** — `checkMatrixPermission` defaultava registro ausente para `"allowed"` (fail-OPEN); agora retorna `"not_set"` e o caller nega + loga. Fallback terminal `permission_not_defined` agora também loga. Tests: `tests/unit/permission-engine-fail-closed.test.ts`.

## Critérios de aceite

- Nenhum return `{ allowed: true }` em path de erro ou loading.
- Comportamento documentado em [[Permissoes Sistema]].
- Testes unit cobrem o novo default deny.
- Regression smoke: testar manualmente roles `admin`, `membro`, `master` em todas as ações sensíveis.

## Notas

Esse padrão `allowed: true` em fallback aparece em `useCanPerformAction*` (linha ~140) e em `useCanPerformActionAsync` (linha ~207). Pode haver outros pontos — auditar com grep.

Mudança é potencialmente disruptiva: se algum lugar do app dependia do fallback permissivo, vai começar a bloquear. Ship com observabilidade (Sentry breadcrumb em todo `allowed: false` por fallback).

### Follow-up server-side (#647)

Server-side `permission_engine.ts` já está fail-closed. Verificado: nenhum call site de edge function dependia do fallback permissivo do matrix — as únicas chamadas vivas ao engine (`move-card.ts` → `move_pipe_record`, `mass-send-create` → `mass_send`) não passam pelo matrix; `import-leads/index.ts` referencia `import_leads` apenas em `logRuntime`, sem `assertPermission`.

**Pendente (frontend twin)**: `src/modules/identity/permissions/lib/permissions.ts:94` ainda retorna `matrix_default_allowed` quando o matrix não tem registro (mesmo bug fail-OPEN, lado cliente). Defesa server-side já cobre, mas o hook `useCanDo` deve espelhar o deny pra UX consistente.
