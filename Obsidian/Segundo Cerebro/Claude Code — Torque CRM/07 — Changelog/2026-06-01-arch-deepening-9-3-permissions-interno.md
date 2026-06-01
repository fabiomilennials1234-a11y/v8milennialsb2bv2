---
type: changelog
title: 2026-06-01 — Arch Deepening 9.3 — identity/permissions interno
status: shipped
created: 2026-06-01
updated: 2026-06-01
tags: [arch-deepening, identity, permissions, refactor]
related:
  - "[[fase-9-identity-split]]"
  - "[[_INDEX]]"
owner: gabriel
---

# 2026-06-01 — Arch Deepening Slice 9.3 (`identity/permissions/` interno)

## Mudanças
- **identity (refactor mecânico)**: criado sub-conceito privado `src/modules/identity/permissions/` (Fase 9, Alt B), espelhando o padrão de `auth/` (9.2). Movidos **9 arquivos** via `git mv` (history preservada) + `permissions/index.ts` (sub-barrel privado). Imports internos repontados + `App.tsx` + `Configuracoes.tsx` + ~44 arquivos de teste. **Zero mudança de lógica/comportamento/schema/tela** — fail-closed preservado byte-a-byte (área frágil 🟠).

## Arquivos tocados
- **Movidos (9, git mv)**:
  - `permissions/lib/permissions.ts` (resolveAction, usePermission, assertPermissionClient, assertPermission + types)
  - `permissions/hooks/{useUserRole, useCanDo, usePermissions, useOrgRolePermissions, useUpdateRolePermission, useResetOrgRolePermissions}.ts`
  - `permissions/components/{PermissionProtectedRoute, PermissionsTab}.tsx`
- **Criado (1)**: `permissions/index.ts` (sub-barrel; PermissionsTab deliberadamente FORA — Configuracoes deep-importa o componente p/ preservar lazy chunk)
- **Imports intra-grupo**: preservados byte-a-byte (lib+hooks+components moveram juntos → refs relativos entre eles inalterados). Só ganharam `../` os refs a arquivos que ficaram em `identity/` (useOrganization, useTeamMembers, useMasterAuth, auth/contexts/AuthContext, auth/hooks/useIdentity).
- **Consumers internos não-grupo (3)**: `auth/hooks/useIdentity.ts`, `components/ProfileSettings.tsx`, `components/SubscriptionProtectedRoute.tsx` → `[../]permissions/hooks/useUserRole`.
- **Barrel raiz `identity/index.ts`**: 13 statements re-apontados `from "./..."` → `from "./permissions"`; segue **44 exports**.
- **App**: `src/App.tsx` — PermissionProtectedRoute → sub-barrel `@/modules/identity/permissions`.
- **Page**: `src/modules/platform/pages/Configuracoes.tsx` — lazy import de PermissionsTab → deep `@/modules/identity/permissions/components/PermissionsTab`.
- **Tests**: 44 arquivos (41 em `tests/unit/` + 3 co-located em `src/modules/leads/**/__tests__/`), 68 substituições de specifier deep (imports + vi.mock; corpo dos mocks intacto).
- **Docs**: `src/modules/identity/CLAUDE.md` (árvore + contagem de hooks 21→15), este changelog, `fase-9-identity-split.md`, `_INDEX.md`.

## Validação (output literal — 2026-06-01, sobre develop pós-merge 9.2 #604)
- `grep -c '^export' identity/index.ts` = **44**
- leak grep (9 deep specifiers em src+tests) + orphan relative refs = **ZERO** (verificado pelo arquiteto)
- `npx tsc --noEmit` (root) = **0 erros** (literal — verificado pelo arquiteto)
- `npm run lint` = **0 errors** / 2543 warnings (`no-explicit-any` pré-existentes; `boundaries/*` não acusa movidos)
- `node scripts/dep-cruise-ratchet.cjs` = **OK — baseline 56, 0 new** (os 9 arquivos estavam em zero ciclos no baseline; move = neutro; NÃO regenerado)
- `npm run test:unit` = **23 failed | 315 passed | 3 skipped** files · **38 failed | 4223 passed | 150 skipped** tests — red set 100% pré-existente, ZERO regressão nova
  - subset dirigido permissão/identity (verificado pelo arquiteto): `use-user-role`, `use-can-do`, `use-permissions-hooks`, `permission-protected-route`, `permissions-fail-closed`, `permissions`, `use-feature-permissions-orgid`, `use-identity` = **8 files / 89 tests, 100% pass**
  - `useLeadActionGates.test.tsx` (co-located, fora do test:unit) 7 red **confirmados pré-existentes** em develop limpo (mock de leaf vs import via barrel; `useAuth must be used within an AuthProvider` — não import quebrado)
  - demais red = import-resolution pré-existente a paths não-identity (`@/hooks/useChannelChat`, `@/lib/evolutionApi`)
- `permission-engine.test.ts` (integration) = **env-blocked** (sem seed de auth no Supabase local: "Invalid login credentials"). Backend `_shared/permission_engine.ts` NÃO tocado — não-regressão. Gate de ambiente, não da slice.

## Segurança (área frágil — Permissões)
Movimento mecânico puro. Lógica fail-closed (`resolveAction`, `useOrgRolePermissions` default-false, `PermissionProtectedRoute` Loading/Error/Lock states) inalterada byte-a-byte. Multi-tenancy (filtro org_id) intacto. Smoke por role SEPARADO = gate do CTO antes do merge.

## Follow-ups / débito
- `vitest.config.ts:48` tem key órfã de coverage threshold `'src/lib/permissions.ts'` — path que **nunca existiu** na estrutura modular (real sempre foi `modules/identity/lib/permissions.ts`, agora `permissions/lib/`). Ignorada silenciosamente pelo provider v8, só relevante em `test:coverage`. **Não tocado** (fora de escopo — não introduzido por esta slice). Candidato a chore.
- Demoção do barrel (PRIV) = slice 9.5. Barrel segue 44 aqui (re-export).
