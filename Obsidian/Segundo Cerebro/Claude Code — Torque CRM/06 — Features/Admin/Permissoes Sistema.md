---
type: feature
title: Permissões Sistema
status: active
created: 2026-04-12
updated: 2026-04-12
tags: [uncategorized]
related: []
owner: gabriel
related_files: []
---

# Permissões Sistema

## O que é

RBAC de 4 camadas: **Master Admin** (Milennials cross-org) → **Organization Admin** (org-scoped) → **Feature Permissions** (`feature_permissions` por org) → **Member Overrides** (`member_feature_permissions` por usuário). RLS no Postgres garante isolamento multi-tenant final.

## Como funciona

```
useCanPerformAction(action) / useCanPerformActionAsync(action)
    │
    ▼
RPC check_action_allowed(action, resource_id?)
    │
    ▼
Postgres: master? → admin? → feature override por user? → role default → deny
```

Frontend hooks ficam em `src/lib/permissions.ts`. Backend mirror em `supabase/functions/_shared/permission_engine.ts` (mesma lógica reaplicada em edge functions sensíveis).

## Regras de negócio

- Toda action sensível (move_pipe_record, edit_workflow, manage_team, manage_copilot, send_message, delete_lead, view_lead, export_leads, trigger_campaign, import_leads) passa pelo engine.
- Master bypass total dentro de qualquer org.
- Admin tem default permissivo dentro da org.
- Membros começam negados, ganham acesso via `feature_permissions` (org-wide) ou `member_feature_permissions` (user-specific override).
- RLS valida tenant + visibilidade de leads/pipes; **não** valida `move_pipe_record` em column-level (gap conhecido — ver abaixo).

## Permissão `move_pipe_record`

Usada por `usePipeWhatsapp`, `usePipeConfirmacao`, `usePipePropostas` e funis customizados. Antes era checada toda vez que `updates.status` aparecia no payload de UPDATE — gerava falsos positivos quando o form mandava o status atual sem alterar.

Desde 2026-04-30, `useUpdatePipeConfirmacao` usa **SELECT-then-compare**:

1. SELECT `current.status` antes do UPDATE.
2. Compara com `payload.status`.
3. Se igual → remove `status` do payload (movimento ≠ mudança real).
4. Se diferente → check de `move_pipe_record` em **fail-closed** (bloqueia também em loading da permission).

Padrão a ser replicado em `useUpdatePipeWhatsapp` e `useUpdatePipePropostas` se aparecer reclamação equivalente. Detalhes em [[Pipe Confirmacao]] e [[ADR-2026-04-30-meeting-date-sync]].

## Gap conhecido — `move_pipe_record` server-side

A barreira final é **client-side**. Caller autenticado que pule o hook (ou use service_role em algum scenário) pode mudar `status` direto. RLS atual em `pipe_confirmacao` valida tenant + visibilidade, **não** `move_pipe_record`. 

Issue HIGH em [[move-pipe-record-server-side]] propõe trigger Postgres ou RPC `SECURITY DEFINER` com check interno + revoke do UPDATE direto da coluna `status`.

## Anti-pattern detectado — fallback `allowed: true`

`src/lib/permissions.ts` tem paths que retornam fallback `allowed: true` em casos de erro/loading (linhas ~140 e ~207). Doutrina é **fail-closed por padrão**: na dúvida, bloqueia.

Auditoria pendente em [[permissions-fallback-fail-closed]].

## Arquivos chave

- `src/lib/permissions.ts` — Engine frontend + hooks (`useCanPerformAction*`).
- `supabase/functions/_shared/permission_engine.ts` — Mirror backend.
- `src/hooks/useUserRole.ts` — Role do usuário logado.
- RPC `check_action_allowed` — fonte da verdade (Postgres).
- `tests/integration/permission-engine.test.ts` — Testes integração.

## Edge cases conhecidos

- Permission em loading (`undefined`) → fail-closed (após 2026-04-30 em hooks de pipe).
- Membro sem override + role default deny → bloqueado.
- Master bypass não aciona check — vai direto.
- Ações sensíveis sem entrada em `feature_permissions` → cai no role default.

## Histórico de mudanças

- 2026-04-30 — `useUpdatePipeConfirmacao` agora usa SELECT-then-compare + fail-closed em loading para `move_pipe_record`. Removeu falso positivo em edit-só-de-data. Issue HIGH gerada para fechar gap server-side. Ver [[Pipe Confirmacao]] e [[ADR-2026-04-30-meeting-date-sync]].
- 2026-04-15 — Agente Security adicionado ao time com poder de veto em mudanças sensíveis. Ver `ADR-2026-04-15-agente-security`.
