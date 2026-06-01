---
type: changelog
title: 2026-05-29 — Arch Deepening 9.2 — identity/auth interno
status: shipped
created: 2026-05-29
updated: 2026-06-01
tags: [arch-deepening, identity, refactor]
related:
  - "[[fase-9-identity-split]]"
  - "[[_INDEX]]"
owner: gabriel
---

# 2026-05-29 — Arch Deepening Slice 9.2 (`identity/auth/` interno)

## Mudanças
- **identity (refactor mecânico)**: criado sub-conceito privado `src/modules/identity/auth/` (Fase 9, Alt B). Movidos 3 arquivos via `git mv` (history preservada): `AuthContext.tsx` → `auth/contexts/`, `useIdentity.ts` → `auth/hooks/`, `ProtectedRoute.tsx` → `auth/components/`. Criado `auth/index.ts` (sub-barrel privado, 4 statements / 5 símbolos). Imports internos repontados (15 sites) + `App.tsx` (2 deep-imports → `@/modules/identity/auth`) + specifiers de teste (~75 ocorrências em 60 arquivos). Zero mudança de lógica/comportamento/schema/tela.

## Arquivos tocados
- **Movidos (3, git mv)**: `src/modules/identity/auth/{contexts/AuthContext.tsx, hooks/useIdentity.ts, components/ProtectedRoute.tsx}`
- **Criado (1)**: `src/modules/identity/auth/index.ts`
- **Imports internos repontados (10)**: `hooks/{useMasterAuth,useOrgSwitcher,useTeamMembers,useUserRole,useCanDo,useOrganizationSettings}.ts`, `components/{SubscriptionProtectedRoute,ProfileSettings,PermissionProtectedRoute}.tsx`, `components/master/MasterRoute.tsx`
- **Imports internos repontados (4)**: `pages/{Auth,Signup,Equipe}.tsx`, `lib/permissions.ts`
- **Barrel raiz**: `src/modules/identity/index.ts` (4 statements auth → `./auth`; segue 44 exports)
- **App**: `src/App.tsx` (2 imports → sub-barrel `@/modules/identity/auth`)
- **Tests**: ~60 arquivos sob `tests/unit/` + 3 sob `src/modules/leads/**/__tests__/` (só path do specifier; corpo dos mocks intacto)
- **Docs**: `fase-9-identity-split.md`, `_INDEX.md`, `src/modules/identity/CLAUDE.md`

## Validação (output literal — resume 2026-06-01, sobre develop pós-merge 9.1b #592)
- `grep -c '^export' identity/index.ts` = **44** (inalterado)
- `tsc --noEmit` (root solution) = **0 erros** (literal — autoritativo; `auth/*` + `App.tsx` type-clean)
- `npm run lint` (full) = **0 errors / 2543 warnings** (warnings = `no-explicit-any` pré-existentes; `boundaries/*` não acusa movidos/App.tsx)
- `node scripts/dep-cruise-ratchet.cjs` = **OK — baseline 56, 0 new** (ver Follow-ups: o net +1 da sessão anterior dissolveu com 9.1b)
- `npm run test:unit` = **24 failed | 314 passed | 3 skipped** files · **39 failed | 4222 passed | 150 skipped** tests — red set 100% pré-existente, ZERO regressão nova da slice
- auth tests dirigidos: `auth-context` ✅, `use-identity` ✅, `permission-protected-route` ✅; `protected-route` 7 red **confirmados pré-existentes** (rodado em develop limpo via stash baseline = mesmos 7 red; `TestingLibraryElementError` de lógica `/checkout`, NÃO import quebrado)
- demais red files = import-resolution pré-existente a paths não-identity (`@/hooks/useChannelChat`, `@/lib/evolutionApi`, etc.) — sem relação com a slice
- leak grep paths antigos (`identity/{contexts/AuthContext,hooks/useIdentity,components/ProtectedRoute}`) em src+tests = **ZERO**
- `AuthContext.tsx` novo path = **byte-idêntico** ao develop (rename puro; sem clobber stale)

## Follow-ups / débito
- ✅ **`dep-cruise-ratchet` RESOLVIDO**: a sessão anterior reportou net +1 (83→84) — re-key do ciclo `ProtectedRoute → useIdentity → … → useRealtimeSubscription → identity barrel` ao mover `useIdentity`. O precursor **9.1b (#592)** quebrou o edge raiz `shared/realtime/useRealtimeSubscription → @/modules/identity` (via `RealtimeOrgContext`/`useRealtimeOrgId`), zerando esses ciclos. Confirmado empiricamente nesta slice: `AuthContext`/`useIdentity`/`ProtectedRoute` em **zero** ciclos; ratchet **0 new vs 56**, sem regenerar baseline.
- `permission-engine.test.ts` (integration) não roda sem Supabase local; não relacionado ao refactor frontend. Gate 9.3 (não 9.2).
