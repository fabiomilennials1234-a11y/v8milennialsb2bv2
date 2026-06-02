---
type: changelog
title: 2026-06-01 — Arch Deepening 9.4 — identity/master interno + demote barrel
status: shipped
created: 2026-06-01
updated: 2026-06-01
tags: [arch-deepening, identity, master, refactor, barrel-demote]
related:
  - "[[fase-9-identity-split]]"
  - "[[_INDEX]]"
owner: gabriel
---

# 2026-06-01 — Arch Deepening Slice 9.4 (`identity/master/` interno + DEMOÇÃO do barrel)

## Decisão de fatiamento (CTO via AskUserQuestion)
9.4 original = `org-team/` + `master/`. Medido o blast: org-team move = ~70 test-files (`useOrganization`×61, `useTeamMembers`×49 mocks); master move = limpo (0 test-mock de master hook, 0 consumer externo via barrel). CTO escolheu **split**: esta slice = **master + demote** (alto valor, isolado); `org-team` vira slice 9.4b. Demoção do barrel é a **primeira redução real** do barrel raiz (44 → 33).

## Mudança (mecânica pura — zero lógica)
- **Sub-conceito `src/modules/identity/master/`** (estilo `auth/`/`permissions/`): `git mv` de **34 arquivos** (history preservada):
  - 6 hooks → `master/hooks/` (useMasterAuth, useMasterOperations, useMasterOrganizations, useMasterPlans, useMasterUsers, useMasterAuditLogs)
  - 15 components → `master/components/` (8 top-level + 7 em `onboarding/`)
  - 13 pages → `master/pages/`
- **`master/index.ts`** (sub-barrel privado) = surface completa do master (12 statements: 6 value-blocks + 6 type-blocks).
- **DEMOÇÃO barrel raiz `index.ts`**: removidos 11 statements master; sobra SÓ `export { useMasterAuth, useCanAccessMaster } from "./master"`. **44 → 33 exports.** Seguro: 0 consumer externo dos 11 demovidos (todos consumidos relativamente dentro de master/pages|components).
- **Imports relativos** reescritos (determinístico): master pages/components → master hooks `../../hooks/useMasterX` → `../hooks/useMasterX`; `useMasterAuth.ts` → `../auth` → `../../auth` (1 nível mais fundo); refs não-master à mesma profundidade (MasterRoute → useIdentity) inalterados.
- **5 importers internos não-master de `useMasterAuth`** (blind-spot do brief, pegos por teste/build — tsc passou mesmo quebrado): `auth/hooks/useIdentity`, `permissions/hooks/useUserRole`, `permissions/components/PermissionsTab` (`../../master/hooks/useMasterAuth`), `hooks/useCurrentTeamMember`, `hooks/useOrgSwitcher` (`../master/hooks/useMasterAuth`).
- **App.tsx**: 12 lazy pages + MasterRoute + MasterLayout → `@/modules/identity/master/{pages,components}/...`.
- **36 test files** repontados (33 `tests/unit/` + 3 co-located leads): `@/modules/identity/hooks/useMaster*` → `@/modules/identity/master/hooks/useMaster*`.

## Validação (output literal — verificado independentemente pelo arquiteto)
- `grep -c '^export' identity/index.ts` = **33** (era 44, −11)
- leak grep (alias `@/modules/identity/{pages,components}/master|hooks/useMaster` + relativos órfãos) = **ZERO** (via ripgrep; `git grep -nE` com grupo está quebrado neste repo Windows)
- mojibake scan (todos os arquivos tocados) = **none** (1ª passada do engenheiro corrompeu encoding via PS5.1 `Get-Content -Raw`; restaurado via `git checkout` + refeito com `sed` byte-safe)
- `npx tsc --noEmit` (root) = **0 erros**
- `npm run lint` = **0 errors** / 2543 warnings (pré-existentes)
- `node scripts/dep-cruise-ratchet.cjs` = **OK — baseline 55, 0 new** (master em zero ciclos; move neutro; App.tsx→master/pages não é flagrado: App fora de `src/modules/`)
- `npm run test:unit` = **24 failed | 314 passed | 3 skipped** files · **39 failed | 4222 passed | 150 skipped** tests — red set pré-existente; subset repointado (use-identity, use-user-role, use-master-auth, use-can-do, use-permissions-hooks) = **5 files / 52 tests pass** (arquiteto)
- `npm run build` = **exit 0** (lazy chunks master compilam → rotas `/master`, `/master/operations` resolvem)
- `git status`: **34 renames (R)** detectados (history preservada)

## Segurança (área frágil — Master ops)
Movimento mecânico. Hotfix #530 (`/master/operations` carrega) preservado — build prova resolução das rotas lazy. `useMasterAuth` (único símbolo master com leak externo) segue público no barrel. Roles admin/master/membro intactos.

## Follow-ups
- **Próximo = slice 9.4b**: mover `org-team/` (useOrganization*/useTeamMembers*/useProfile*/team components/Equipe) — os ~70 test-files. Relocação pura (sem demote; org-team é PUB-heavy, segue no barrel). 9.5 = purgar barrel (demote PRIV org-team → ≤20).
- `WhatsAppMigration.tsx` (em `pages/master/`) é órfã (sem importer) — pegou carona no move, sem ajuste.
