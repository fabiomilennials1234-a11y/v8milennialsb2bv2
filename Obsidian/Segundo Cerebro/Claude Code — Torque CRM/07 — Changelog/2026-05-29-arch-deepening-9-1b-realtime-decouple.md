---
type: changelog
title: 2026-05-29 — Arch Deepening 9.1b: desacoplar realtime → identity
status: shipped
created: 2026-05-29
updated: 2026-05-29
tags: [changelog, arquitetura, shared-realtime, identity, arch-deepening]
related:
  - "[[fase-9-identity-split]]"
owner: gabriel
branch: feat/arch-deepening/09-1b-realtime-decouple
---

# 2026-05-29 — Arch Deepening 9.1b: desacoplar realtime → identity

## Mudanças

- **shared/realtime**: invertida a dependência `realtime → identity`. `useRealtimeSubscription` deixa de importar `useOrganization` de `@/modules/identity` e passa a ler o org-id de um contexto React owned por `shared/realtime`, alimentado por `identity` no root do app. Quebra o ciclo `shared → module` que ancorava 27 violações `no-circular` no dep-cruise.
- **dep-cruise**: baseline **83 → 56** (`no-circular` 60 → 33; `no-orphans` 23 inalterado). Baseline regenerado (redução justificada — ver lista de edges removidos abaixo).

## Por quê

`src/shared/realtime/useRealtimeSubscription.ts:3` importava `useOrganization` do barrel raiz `@/modules/identity`. Esse edge `shared → module` fechava um ciclo: o barrel re-exporta `useTeamMembers` e `useOrgRolePermissions`, ambos consumidores de `useRealtimeSubscription`, que reimportava o barrel. Resultado: todos os ciclos que atravessavam `useRealtimeSubscription` (anchor `identity/index.ts`). Esse ciclo **bloqueava a slice 9.2** (mover arquivos de `identity` re-chavearia os edges cíclicos cross-boundary a cada slice).

Decisão arquitetural (arquiteto, aprovada pelo CTO): inverter via contexto React, mesmo espírito do `PipeOpsPort` da Fase 7. Realtime LÊ o org-id; identity POPULA. Realtime não importa mais identity. Reatividade a org switch preservada (contexto reativo).

## Arquivos tocados

- `src/shared/realtime/realtime-org-context.tsx` — **novo**. `RealtimeOrgProvider` + `useRealtimeOrgId()`. Só importa `react` (shared → shared/core ✓).
- `src/shared/realtime/useRealtimeSubscription.ts` — remove import de `@/modules/identity`; lê org-id via `useRealtimeOrgId()`. Lógica de filtro/debounce inalterada.
- `src/App.tsx` — import deep de `useOrganization` (preserva code-splitting) + `RealtimeOrgProvider`; novo `RealtimeOrgBridge` montado entre `<AuthProvider>` e `<PipeOpsProvider>`, envolvendo toda a árvore de realtime.
- `tests/unit/useRealtimeSubscription-refactored.test.ts` — mock trocado de `@/modules/identity/hooks/useOrganization` para `@/shared/realtime/realtime-org-context` (`useRealtimeOrgId: () => mockOrgId`). Asserts de filtro `organization_id=eq.X` preservados.
- `tests/unit/hooks-realtime-sub.test.ts` — idem (mock da nova fonte de org-id).
- `.dependency-cruiser-baseline.json` — regenerado (83 → 56).

## Métrica dep-cruise — 27 `no-circular` removidos (0 adicionados)

Todos os ciclos ancorados em `identity/index.ts` ↔ `useTeamMembers`/`useOrgRolePermissions` → `useRealtimeSubscription` → barrel. Edges removidos:

- `identity/index.ts → {useIdentity, useOrganization, useOrgSwitcher, useUserRole, lib/permissions}`
- `components/{PermissionProtectedRoute, ProtectedRoute, SubscriptionProtectedRoute} → {useIdentity, useUserRole}`
- `hooks/useTeamMembers → shared/realtime/useRealtimeSubscription`
- `hooks/useOrgRolePermissions → shared/realtime/useRealtimeSubscription` (+ `→ useOrganization`)
- `hooks/{useCanDo, useIdentity, useOrganizationSettings, useOrgQuotas, usePermissions, useResetOrgRolePermissions, useUpdateRolePermission} → {useIdentity/useUserRole/useOrganization/useOrgRolePermissions}`
- `lib/permissions → {useOrganization, usePermissions, useUserRole}`

Confirmação empírica: `useIdentity`, `ProtectedRoute`, `useUserRole`, `useOrgRolePermissions`, `useRealtimeSubscription` agora aparecem em **zero** ciclos. Nenhum ciclo atravessa `shared/realtime`. (Chave para destravar 9.2.)

**Residual (escopo 9.4):** 1 ciclo intra-identity `useTeamMembers ↔ useOrganization` (sem cross-boundary, sem realtime). Endereçado ao reorganizar `org-team/`.

## Auto-QA (output literal)

- `node scripts/dep-cruise-ratchet.cjs` → `Dep-cruise ratchet OK. Baseline pending: 56 violations.`
- `npx tsc --noEmit -p tsconfig.app.json` → exit 0, 0 erros.
- `npx tsc --noEmit` (root) → exit 0, 0 erros.
- `npm run lint` → `✖ 2451 problems (0 errors, 2451 warnings)` — 0 errors; warnings todos pré-existentes.
- `npm run test:unit` (atual) → `Test Files 26 failed | 280 passed | 3 skipped (309)` / `Tests 40 failed | 3946 passed | 150 skipped (4136)`.
- `npm run test:unit` (baseline `d902ddc4`, via git worktree limpo) → `27 failed files / 43 failed tests / 3943 passed`.
- **Diff red set: 0 arquivos novos falhando.** (`auth-context.test.ts` — flaky async pré-existente do baseline CI red — passou neste run; sem relação com a mudança.)
- `npx vitest run tests/unit/useRealtimeSubscription-refactored.test.ts tests/unit/hooks-realtime-sub.test.ts` → `Test Files 2 passed (2)` / `Tests 23 passed (23)`.

## Invariantes verificadas

- **Comportamento preservado**: filtro `organization_id=eq.<org>` continua aplicado quando há org; re-filtra ao trocar de org (contexto reativo). Sem mudança em subscription/debounce.
- **Multi-tenancy 🟠**: filtro de tráfego mantido; tabelas em `TABLES_WITHOUT_ORG_ID` continuam wildcard. RLS continua sendo a defesa real.
- **Boundaries**: `shared/realtime` só importa `react` no arquivo novo. Sem novo edge `shared → module`.

## Follow-ups

- Slice 9.2 (auth interno) desbloqueada — pode prosseguir do baseline 56.
- Residual intra-identity (`useTeamMembers ↔ useOrganization`) a resolver em 9.4 (org-team).
- Alvos globais do roadmap (`baseline ≤ 70`, `no-circular ≤ 50`) já atingidos por esta precursora.
