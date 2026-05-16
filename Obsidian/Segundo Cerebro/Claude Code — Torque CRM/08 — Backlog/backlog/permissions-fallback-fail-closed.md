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
- [ ] Mirror em `supabase/functions/_shared/permission_engine.ts` se houver paths similares.

## Critérios de aceite

- Nenhum return `{ allowed: true }` em path de erro ou loading.
- Comportamento documentado em [[Permissoes Sistema]].
- Testes unit cobrem o novo default deny.
- Regression smoke: testar manualmente roles `admin`, `membro`, `master` em todas as ações sensíveis.

## Notas

Esse padrão `allowed: true` em fallback aparece em `useCanPerformAction*` (linha ~140) e em `useCanPerformActionAsync` (linha ~207). Pode haver outros pontos — auditar com grep.

Mudança é potencialmente disruptiva: se algum lugar do app dependia do fallback permissivo, vai começar a bloquear. Ship com observabilidade (Sentry breadcrumb em todo `allowed: false` por fallback).
