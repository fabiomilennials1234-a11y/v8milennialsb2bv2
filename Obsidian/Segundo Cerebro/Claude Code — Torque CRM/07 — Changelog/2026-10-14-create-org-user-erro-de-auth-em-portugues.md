---
type: changelog
title: create-org-user — recusa do Supabase Auth chega em português na tela
status: in-progress
created: 2026-10-14
updated: 2026-10-14
tags: [changelog, auth, equipe, edge-function, erros]
related: []
owner: claude-agent
---

# 2026-10-14 — create-org-user: recusa do Auth em português

## Contexto
2026-10-13 21:10 UTC: criação de admin pela tela recusada pelo Supabase Auth (`POST /admin/users` 422, `weak_password`, senha vazada/HIBP). A edge repassava o texto em inglês com 400; `toAppError` só exibe frase PT → tela mostrou erro genérico com referência. O admin não soube que o problema era a senha.

## Mudanças
- **Auth / create-org-user**: recusa de `auth.admin.createUser` traduzida por `mapAuthCreateError` (code primeiro, texto como fallback). Senha fraca → 422 com frase por motivo (`pwned` > `length` > `characters` > genérica); e-mail inválido → 422; já cadastrado → 409 (inalterado); limite → 429; desconhecido → 400 (Auth 4xx) ou 502 (Auth 5xx/sem status) com "Não foi possível criar o usuário.".
- Falha (exceto e-mail já cadastrado) grava `runtime_logs` (`module=auth`, `action=create_user`, `stage=auth_create_user`, `kind`, `auth_code`, `auth_status`, `reasons`) com o texto técnico e e-mail mascarado. Senha nunca logada.

## Arquivos tocados
- `supabase/functions/_shared/auth-create-error.ts` — `mapAuthCreateError`, `authCreateErrorLogDetail`.
- `supabase/functions/_shared/auth-create-error.test.ts` — 21 testes Deno (caso real incluído).
- `supabase/functions/create-org-user/index.ts` — ramo de erro do `createUser`.
- `tests/unit/create-org-user-auth-error-message.test.ts` — prova que cada frase passa por `functionsErrorFromResponse` → `toAppError` intacta (caminho de Equipe.tsx e MasterUsers.tsx).

## Follow-ups
- Mesmo padrão (texto do Auth cru ao usuário) em `admin-reset-user-password` e `create-gestor` — candidatos a reusar `mapAuthCreateError`.
- Deploy da edge `create-org-user` pendente (humano).
