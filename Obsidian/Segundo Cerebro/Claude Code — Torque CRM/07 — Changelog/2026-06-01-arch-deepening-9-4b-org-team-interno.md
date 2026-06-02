---
type: changelog
title: 2026-06-01 — Arch Deepening 9.4b — identity/org-team interno
status: shipped
created: 2026-06-01
updated: 2026-06-01
tags: [arch-deepening, identity, org-team, refactor]
related:
  - "[[fase-9-identity-split]]"
  - "[[_INDEX]]"
owner: gabriel
---

# 2026-06-01 — Arch Deepening Slice 9.4b (`identity/org-team/` interno)

## Contexto
2ª metade do 9.4 fatiado (CTO): 9.4 = master+demote (#620, merged); **9.4b = org-team move**. PUB-heavy ⇒ **SEM demote** (barrel segue 33, re-aponta statements org-team pra `./org-team`). Maior blast de teste da Fase 9 (~86 test-files mockam useOrganization/useTeamMembers). Movimento **mecânico puro** — zero lógica/tela/schema. ÁREA FRÁGIL: org context (useOrganization provê o `organization_id` de TODA query).

## Mudança
- **Sub-conceito `src/modules/identity/org-team/`** (estilo auth/permissions/master): **14 `git mv`** (history preservada):
  - 8 hooks → `org-team/hooks/`: useOrganization, useOrganizationSettings, useOrgQuotas, useOrgSwitcher, useSeatUsage, useTeamMembers, useCurrentTeamMember, useProfiles
  - 4 team components → `org-team/components/team/`; ProfileSettings → `org-team/components/`; Equipe → `org-team/pages/`
  - `org-team/index.ts` sub-barrel privado (14 statements org-team).
- **Ficam em `hooks/`**: useAutoAdminAssignment, useAvatarMap (não org-team).
- **Imports**: siblings entre os 8 hooks inalterados; refs a auth/master ganharam `../` (useOrganizationSettings, useOrgSwitcher, useCurrentTeamMember, ProfileSettings).
- **Barrel raiz**: 14 statements org-team re-apontados `from "./hooks/..."` → `from "./org-team"`. **33 inalterado (sem demote).**
- **Consumers internos (10)**: auth/{useIdentity,ProtectedRoute} + permissions/{usePermissions,useUserRole,useOrgRolePermissions,useUpdateRolePermission,useResetOrgRolePermissions,lib/permissions,PermissionsTab,PermissionProtectedRoute} → `../../org-team/hooks/...`.
- **Consumers externos deep (pré-existentes, relocados)**: App.tsx (RealtimeOrgBridge useOrganization + lazy Equipe), copilot/useBuilderSession, leads/useQuickBlast — JÁ deep-importavam `identity/hooks/useX` em develop; só relocados pro novo path (débito de boundary pré-existente, não introduzido aqui).
- **~86 test files** repontados (81 `tests/unit/` + 5 co-located): vi.mock/import deep dos 8 hooks `hooks/` → `org-team/hooks/`.

## Validação (output literal — verificado independentemente pelo arquiteto)
- `grep -c '^export' identity/index.ts` = **33** (inalterado — sem demote)
- leak grep (alias + relativo, ripgrep) = **ZERO** · mojibake = **none** · **14 renames** (A+D pareados)
- `npx tsc --noEmit` (root) = **0 erros**
- `npm run lint` = **0 errors** / 2543 warnings (pré-existentes)
- `node scripts/dep-cruise-ratchet.cjs` = **OK — baseline 55, 0 new** (org-team em zero ciclos; move neutro; baseline NÃO tocado)
- `npm run test:unit` = **24 failed | 314 passed | 3 skipped** files · **39 failed | 4222 passed | 150 skipped** tests — red set pré-existente (engenheiro provou via baseline stashed: delta = `refactor-smoke` flaky + `shared-action-handler-compat::moveStage` pipeline, NÃO identity); subset org/team/identity (use-organization, use-team-members, use-identity, use-user-role, hooks-sprint2-team-members, use-permissions-hooks, test-db-wrapper) = **7 files / 78 tests pass** (arquiteto)
- `npm run build` = **exit 0** (org context + Equipe lazy resolvem)

## Segurança (área frágil — org context)
useOrganization = `organization_id` de toda query (multi-tenancy). Bodies verbatim (relocação), zero lógica. Smoke obrigatório: login → org resolve; org switcher re-filtra; equipe carrega.

## Follow-ups (débito pré-existente, NÃO desta slice)
- Deep-imports cross-module de App.tsx/useBuilderSession/useQuickBlast pra `org-team/hooks/*` (em vez do barrel) — boundary debt anterior; candidato a chore (App.tsx é exceção legítima por code-splitting; os outros 2 não).
- Orphans (ProfileSettings, TeamMemberCard, TeamStats) sem importer — movidos fielmente; candidatos a remoção.
- **Próximo = slice 9.5**: purgar barrel raiz (demote statements PRIV org-team/profile → alvo ≤20, ratio ≥3.0). Atualizar identity/CLAUDE.md.
