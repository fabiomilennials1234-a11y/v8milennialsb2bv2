# Slice 17 — Docs + ESLint boundaries flip warn→error

**Branch:** `feat/modularizacao/17-docs-eslint-flip`
**Base:** `develop` (com PR #512 já mergeada)
**Target PR:** `develop`
**Estimate:** 4h
**Pode rodar em paralelo com:** Slice 19 (event-bus piloto)

## Constraints invariantes (NÃO violar)

1. Zero push em `main`. Zero merge em `main`.
2. Zero mutação em prod DB (`jsjsmuncfkbsbzqzqhfq`).
3. Zero deploy edge functions.
4. Branch sai de `develop` atualizada. PR target = `develop`.
5. Sem `--no-verify`, sem skip de hooks.
6. Antes de começar: `git checkout develop && git pull origin develop` — garantir que PR #512 (slice 16 cleanup longtail) já está merged. Se não estiver, **PARAR** e perguntar ao CTO.

## Contexto

A modularização migrou todo `src/` para `src/modules/<bc>/` (14 módulos), `src/shared/`, e mantém `src/components/ui/` (shadcn). `eslint-plugin-boundaries` está configurada em **warn-only** desde slice 1. Slice 16 esvaziou o root de `src/components/`, `src/hooks/`, `src/pages/`.

Esta slice:
1. Promove boundaries a **error** (gate definitivo).
2. Atualiza documentação raiz e vault para refletir o estado final modular.
3. Atualiza sub-CLAUDE.md dos módulos afetados pela slice 16 (longtail).
4. Atualiza SPEC para registrar decisão "slice 15 real descartada".

Slice 18 (finalize) depende desta slice estar verde.

## Tarefas

### 1. Sincronizar branch

```bash
git checkout develop
git pull origin develop
# Confirmar que commit d498440a (slice 16) está em develop
git log --oneline -5 | grep "slice 16"
git checkout -b feat/modularizacao/17-docs-eslint-flip
```

### 2. Atualizar sub-CLAUDE.md dos módulos afetados pela slice 16

Cada módulo abaixo precisa ter o `CLAUDE.md` atualizado com os novos componentes/hooks que slice 16 trouxe pra dentro:

- `src/modules/identity/CLAUDE.md` — adicionar `components/team/{MemberPermissions, SeatUsageBar, TeamMemberCard, TeamStats}`, `hooks/{useAvatarMap, useAutoAdminAssignment}`.
- `src/modules/communication/CLAUDE.md` — adicionar `components/{email/*, sms/*, ai/AiEmailWriter}`, `hooks/{useEmailAccounts, useEmails, useSms, useAiEmailDrafts}`, `pages/MessageTemplates`.
- `src/modules/leads/CLAUDE.md` — adicionar `components/bulk-actions/BulkActionBar`, `hooks/{useTags, useImportBatches, useEnrichment, useBulkActions, useBulkSelection}`.
- `src/modules/pipelines/CLAUDE.md` — adicionar `hooks/useLossReasons`.
- `src/modules/integrations/CLAUDE.md` — adicionar `hooks/{useGoogleCalendar, useGoogleCalendarSharing}`.
- `src/modules/platform/CLAUDE.md` — adicionar `components/{command/*, saved-views/*, layout/*}`, `hooks/{useSavedViews, useApplyViewFromUrl, useGlobalShortcuts, useKeyboardShortcuts, useSandbox}`.
- `src/modules/copilot/CLAUDE.md` — adicionar `components/oraculo/OraculoComercial`.
- `src/modules/engagement/CLAUDE.md` — adicionar `components/{calls/LogCallModal, ai/CoachingSidebar, ai/NextBestActionsPanel}`.

Cada sub-CLAUDE.md deve listar a API pública atual e remover referências obsoletas a `@/hooks/...` ou `@/components/...` antigos.

### 3. Atualizar CLAUDE.md raiz do projeto

Arquivo: `CLAUDE.md`.

- Reescrever a seção "Estrutura" para refletir `src/modules/<bc>/`, `src/shared/`, `src/components/ui/` (shadcn intacto).
- Atualizar contagens (eram 263 hooks no root → agora 1; 46 components subpastas → agora 1+1).
- Atualizar lista de áreas frágeis para citar paths modulares (`src/modules/copilot/...`, `src/modules/communication/components/whatsapp/...`).
- Manter convenções de naming, comandos npm, gotchas, fluxo de subagentes — só atualizar referências de path.

### 4. Atualizar AGENTS.md

Arquivo raiz `AGENTS.md`. Atualizar pra refletir 14 módulos com paths atuais.

### 5. Atualizar llms.txt raiz

Arquivo raiz `llms.txt`. Index curado pra LLMs. Adicionar links pros sub-CLAUDE.md de cada módulo. Remover links obsoletos.

### 6. Atualizar vault Obsidian

- `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/02 — Arquitetura/Modulos.md` — refletir estado final.
- `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/00 — INDEX.md` — atualizar links se necessário.
- `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/10 — Remodelagem/04-execucao/slices.md` — marcar slices 0-16 ✅, anotar slice 15 real descartada.

### 7. Atualizar SPEC

Arquivo: `.specs/features/modularizacao/SPEC.md`. Adicionar adendo "2026-05-28 — Slice 15 real descartada" explicando que Supabase CLI exige flat layout. Marcar slice 16 (cleanup longtail) como adicionada ao roadmap original.

### 8. Flip ESLint boundaries warn → error

Procurar arquivo de config:

```bash
grep -l "eslint-plugin-boundaries\|@boundaries/" .eslintrc* eslint.config.* 2>/dev/null
```

Localizar a regra `boundaries/element-types` ou `boundaries/no-private` e mudar severity `warn` → `error`. Manter o `dependency-cruiser` config como está.

Rodar lint local:

```bash
npm ci  # se node_modules ausente
npm run lint
```

**Se aparecer violation real:**
- Decidir caso a caso: converter o cross-import pra `@/modules/<bc>` (via index.ts público) **OU** registrar exceção temporária em `.specs/features/modularizacao/SLICE-17-EXCEPTIONS.md` com TODO.
- Não desligar a regra inteira.
- Não converter para `warn` de volta.

### 9. Expandir API pública dos módulos (se lint exigir)

Se algum cross-import deep (`@/modules/leads/hooks/useTags`) for flagado pelo flip, **promover** o export pro `index.ts` do módulo:

```ts
// src/modules/leads/index.ts (exemplo)
export { useTags } from "./hooks/useTags";
```

E ajustar os consumers para importar via `@/modules/leads` (sem `/hooks/...`).

### 10. Build local

```bash
npm run build 2>&1 | tail -20
```

Tem que passar. Se vite falhar de path, voltar pra corrigir.

### 11. Commit + push + PR

```bash
git add -A
# Verificar git status NÃO inclui Obsidian/Segundo Cerebro/feature-overview.md (untracked do CTO)
git status --short | grep -i "obsidian.*feature-overview" && echo "PARAR — não comitar"

git commit -m "feat(modularizacao): slice 17 — docs + ESLint boundaries flip warn→error

Atualiza CLAUDE.md raiz + AGENTS.md + llms.txt + vault + sub-CLAUDE.md de 8
módulos afetados pela slice 16. Promove boundaries para error mode (gate
definitivo). API pública expandida em módulos onde flip flagrou cross-imports.

SPEC atualizada com adendo descartando slice 15 real (Supabase CLI exige flat
layout para edge functions; doc-only mapping é o estado final).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

git push -u origin feat/modularizacao/17-docs-eslint-flip
gh pr create --base develop --head feat/modularizacao/17-docs-eslint-flip --title "feat(modularizacao): slice 17 — docs + ESLint boundaries flip warn→error" --body "<resumo das tarefas executadas>"
```

## Critério de aceite

- [ ] Todos os 14 sub-CLAUDE.md refletem estado pós-cleanup (slice 16).
- [ ] CLAUDE.md raiz reflete estrutura modular atual.
- [ ] AGENTS.md atualizado.
- [ ] llms.txt atualizado.
- [ ] Vault `02 — Arquitetura/Modulos.md` atualizado.
- [ ] SPEC com adendo slice 15 descartada.
- [ ] ESLint boundaries em `error` mode.
- [ ] `npm run lint` passa (ou exceptions documentadas em arquivo dedicado).
- [ ] `npm run build` passa.
- [ ] PR aberto contra `develop`.

## Riscos + mitigação

- **Flip pode flagrar muitas violations.** Mitigação: contar antes (`npm run lint` em warn mode primeiro pra prever volume). Se >50 violations, considerar split em sub-slice por módulo.
- **`feature-overview.md` no vault não commitar.** Memória `feedback_squash_stacked_prs.md` lembra do incidente. Verificar `git status` antes de cada `git add`.
- **Auto-update de Modulos.md no vault pode brigar com Vault Sentinel.** Se commit falhar por vault flag, revisar mensagem do hook.

## Out of scope

- Edge functions reorg (slice 15 real — descartada).
- Event-bus (slice 19 paralela).
- Delete legacy folders + ADR conclusão (slice 18).
- Mudança de comportamento de runtime.
