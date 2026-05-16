---
type: tutorial
title: Primeiro PR — Convenções na Prática
status: active
created: 2026-05-15
updated: 2026-05-15
tags: [tutorial, onboarding, git, pr]
related: ["[[01-onboarding-dev]]", "[[Convencoes]]"]
owner: gabriel
audience: dev-novo
estimated_time_min: 45
---

# Primeiro PR — Convenções na Prática

> Tutorial: aprender abrindo PR de verdade. Pegar bug LOW do backlog ou
> melhoria pequena (microcopy, ordering, etc.).

## O que você vai aprender

- Branch naming
- Conventional Commits
- PR template
- Como passar no `vault-sentinel`
- Como pedir review

## Antes de começar

- [ ] Setup completo (ver [[01-onboarding-dev]])
- [ ] Git hook instalado (`git config core.hooksPath scripts/git-hooks`)
- [ ] Acesso ao repo no GitHub

## 1. Escolher task

Vá em [[08 — Backlog/_MOC|Backlog]] ou pegue um item LOW de:
- [[microcopy-reschedule-modal]]
- [[toast-sync-inverso-falha]]
- [[triggerStageChangedWorkflows-duplicate]]

Item BAIXA prioridade = perdão maior pra erro.

## 2. Branch nova

```bash
git checkout main
git pull origin main
git checkout -b fix/microcopy-reschedule
```

Naming: `<tipo>/<slug-kebab>`. Tipos: `feat`, `fix`, `refactor`, `docs`,
`chore`, `security`, `perf`, `test`.

## 3. Fazer mudança

Edite o que precisa. Por exemplo:

```typescript
// src/components/.../RescheduleModal.tsx
- "Erro ao reagendar"
+ "Não foi possível reagendar — verifique data e tente novamente"
```

## 4. Commit

```bash
git add src/components/.../RescheduleModal.tsx
git commit
```

Editor abre. Escreva:

```
fix(microcopy): clarify reschedule error message

Old message ("Erro ao reagendar") was vague. Updated to explain user
should verify date and retry. No code logic change.
```

Conventional Commits:
- Linha 1: `<tipo>(<escopo>): <descrição imperativa minúscula>`
- Linha em branco
- Corpo opcional (por quê, não o quê)

## 5. Push

```bash
git push -u origin fix/microcopy-reschedule
```

GitHub retorna URL pra abrir PR.

## 6. Abrir PR

Acesse a URL. Preencha template:

- **Tipo**: marcar `fix`
- **Vault**: marcar "Não tocou em Obsidian/"
- **Multi-tenancy**: "Não toca em paths sensíveis"
- **DB**: "Sem mudanças de schema"
- **Edge fn**: "Sem mudanças"
- **Testes**: "Manual / smoke" — descrever que testou local
- **Como testar**: passos pro reviewer

## 7. CI

GitHub Actions roda:
- `vault-sentinel` (mesmo sem mudança em vault, valida count)
- Testes
- Build

Se falhar: ler logs, corrigir, push novo commit. Mesma branch.

## 8. Review

CODEOWNERS adiciona CTO automaticamente. Aguarde review. Se pedir mudança:
- Não force-push
- Commit normal com `fix:` no scope
- Responder comentários no PR

## 9. Merge

CTO aprova → squash & merge. Branch deletada.

## Erros comuns

❌ Branch `main-fix-x` — naming errado, use `fix/x`
❌ Commit "fixed bug" — sem tipo conv commit
❌ Push direto em main — bloqueado por branch protection
❌ PR sem template preenchido — reviewer pede revisão
❌ `git push -f` em PR em review — confunde reviewer

## Checklist final

- [ ] Branch nomeada `<tipo>/<slug>`
- [ ] Commits Conventional Commits
- [ ] Hook pre-commit passou (proteção vault)
- [ ] CI verde
- [ ] PR template preenchido
- [ ] Review CTO aprovou

## Próximo passo

[[03-tour-vault]] — entender o vault em profundidade pra próximos PRs tocarem
docs corretamente.
