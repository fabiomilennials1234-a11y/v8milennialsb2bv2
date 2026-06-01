---
type: changelog
title: 2026-06-01 — Arch Deepening 9.5 — purga do barrel identity (Fase 9 CONCLUÍDA)
status: shipped
created: 2026-06-01
updated: 2026-06-01
tags: [arch-deepening, identity, refactor, barrel]
related:
  - "[[fase-9-identity-split]]"
  - "[[_INDEX]]"
  - "[[inventario-identity]]"
owner: gabriel
---

# 2026-06-01 — Arch Deepening Slice 9.5 (purga do barrel `identity/index.ts`) — ÚLTIMA da Fase 9

## Contexto
Última slice da Fase 9. Os 4 sub-conceitos (auth/permissions/master/org-team) já isolados (9.2–9.4b). 9.5 = **purgar o barrel raiz**: remover do `index.ts` os símbolos sem reach cross-module (ficam só nos sub-barris privados). Movimento mecânico (edição de barrel), zero lógica/tela/schema.

## Análise de reach (empírica, não confiando no inventário stale)
`rg` multiline quote-agnostic sobre `import {…} from "@/modules/identity"` em todo `src`+`tests` (excl. identity) → **24 símbolos com consumer externo via barrel** (PUB). Sem namespace-import (`import * as`), sem single-quote leak. Os demais ~45 símbolos do barrel = **PRIV** (0 reach externo) → demovidos.

## Mudança
- **Barrel `identity/index.ts`: 33 → 9 statements** (ratio 71 files / 9 = **7.9**, alvo ≥3.0). Mantidos os **24 símbolos PUB** + 4 públicos-por-intenção (AuthProvider, ProtectedRoute, PermissionProtectedRoute, SubscriptionProtectedRoute — route guards/provider; consumidos por App via sub-barril mas API pública). Agrupados por sub-conceito (auth/permissions/master/org-team/components).
- **Demovidos (~45 símbolos)** pros sub-barris (auth/permissions/master/org-team já os exportam): resolver internals (resolveAction, usePermission, assertPermissionClient), role internos (useHasRole, useIsAdmin, useMetricType), useCanAccessMaster, granular perms (useMyPermissions, PERMISSION_LABELS, useOrgRolePermissions, useUpdateRolePermission, useResetOrgRolePermissions, etc.), org/team internos (useRequiredOrganization, useSeatUsage, useTeamMember, useUpdateTeamMember, useDeleteTeamMember, getSelectedOrgId, setSelectedOrgId, useProfile, useProfiles) + ~20 types sem reach (AppAction, Identity, AppRole, UserRole, PermissionKey, OrgType, QuotaInfo, SwitcherOrg, SeatUsage, TeamMemberInsert/Update, Profile, …).
- **1 repoint interno**: `org-team/components/team/SeatUsageBar.tsx` importava `type SeatUsage` via o root barrel (self-import) → repontado pra `../../hooks/useSeatUsage` (único caso; demais self-imports internos — useAuth/useTeamMembers/useIdentity — são PUB, mantidos).

## Validação (output literal)
- `grep -c '^export' identity/index.ts` = **9** (era 33; ≤20 ✓)
- ratio files/exports = 71/9 = **7.9** (alvo ≥3.0 ✓)
- `npx tsc --noEmit` (root) = **0 erros** — **guardrail decisivo**: qualquer consumer externo de símbolo demovido via barrel daria "has no exported member". 0 = reach analysis correta.
- `npm run lint` = **0 errors** / 2543 warnings (pré-existentes)
- `node scripts/dep-cruise-ratchet.cjs` = **OK — baseline 55, 0 new** (neutro; identity já 0 ciclos)
- `npm run test:unit` = **23 failed | 315 passed | 3 skipped** files · **38 failed | 4223 passed | 150 skipped** tests — red set pré-existente; **zero** erro "has no exported member" (nenhum teste importava símbolo demovido via barrel)
- `npm run build` = **exit 0** (route guards + lazy pages resolvem)

## Fase 9 — CONCLUÍDA
| Métrica | Antes (Fase 9) | Depois | Alvo |
|---|---:|---:|---|
| barrel statements | 44 | **9** | ≤20 |
| files-per-export | 1.50 | **7.9** | ≥3.0 |
| dep-cruise baseline | 83 | **55** | ≤70 |
| no-circular | 60 | **32** | ≤50 |

`identity` agora = 4 sub-conceitos privados (auth/permissions/master/org-team) + barrel enxuto de 28 símbolos públicos. Todos os alvos batidos.

## Segurança (área frágil)
Permissões/auth no barrel: só re-exports demovidos, zero mudança de lógica. fail-closed intacto. tsc+build+test provam que nenhum consumer quebrou.

## Follow-ups (débito pré-existente, fora de escopo)
- Self-imports internos via root barrel (useAutoAdminAssignment→useAuth, MemberPermissions→useTeamMembers/useIdentity) — deviam ser relativos; chore.
- Deep-imports cross-module (useBuilderSession/useQuickBlast) flagados em 9.4b.
- Promoção a Alt A (split físico em 4 BCs) — avaliar na Fase 10 se sub-conceitos provarem-se autônomos.
