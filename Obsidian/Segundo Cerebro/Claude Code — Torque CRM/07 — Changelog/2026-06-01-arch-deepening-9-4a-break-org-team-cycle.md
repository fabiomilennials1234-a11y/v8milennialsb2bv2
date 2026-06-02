---
type: changelog
title: 2026-06-01 — Arch Deepening 9.4a — quebrar ciclo useOrganization↔useTeamMembers
status: shipped
created: 2026-06-01
updated: 2026-06-01
tags: [arch-deepening, identity, refactor, dep-cruise]
related:
  - "[[fase-9-identity-split]]"
  - "[[_INDEX]]"
owner: gabriel
---

# 2026-06-01 — Arch Deepening Slice 9.4a (precursora: quebrar ciclo `useOrganization↔useTeamMembers`)

## Por quê (precursora, estilo 9.1b)
9.4 (mover `org-team/` + `master/` + demote barrel) está bloqueada: `useOrganization` e `useTeamMembers` são o **único ciclo restante** em identity (1 das 56 baseline violations: `no-circular useOrganization → useTeamMembers`). Mover ambos re-chaveia o ratchet (edge-keyed) → trava. Decisão CTO (AskUserQuestion): **precursora dedicada** pra matar o ciclo antes do move (espelha 9.1b). Move 9.4 fica ratchet-neutro.

## Causa-raiz do ciclo (file-level)
`useTeamMembers.ts` agregava DOIS conceitos: (1) `useCurrentTeamMember` + seleção de org (localStorage) — **org-independente**, só usa `useAuth` + `useMasterAuth`; (2) hooks org-scoped (`useTeamMembers` lista + mutations) — usam `useOrganization`. `useOrganization` importava `useCurrentTeamMember` de `./useTeamMembers` ⇒ ciclo `useOrganization → useTeamMembers → useOrganization`.

## Mudança (mecânica pura — zero lógica)
- **Extraído** `src/modules/identity/hooks/useCurrentTeamMember.ts` (novo): `useCurrentTeamMember`, `getSelectedOrgId`/`setSelectedOrgId`, `isVirtualTeamMember`, `buildVirtualTeamMember` (interno), types `TeamMember`/`TeamMemberInsert`/`TeamMemberUpdate`. **Bodies verbatim** (slice por linha via `sed`, sem retranscrição — área frágil). NÃO importa `useOrganization` nem `useTeamMembers`.
- **`useTeamMembers.ts`**: mantém os hooks org-scoped; **re-exporta** os símbolos extraídos (`export { ... } from "./useCurrentTeamMember"`) ⇒ superfície pública (barrel raiz + ~todos consumers) **inalterada**.
- **`useOrganization.ts`**: importa `useCurrentTeamMember` de `./useCurrentTeamMember` (era `./useTeamMembers`) — **edge quebrado**.
- **`useOrgSwitcher.ts`**: importa `setSelectedOrgId` de `./useCurrentTeamMember` (decoupling do módulo team pesado).
- **`tests/unit/use-organization.test.ts`**: `vi.mock` repontado `useTeamMembers` → `useCurrentTeamMember` (o consumer mudou a fonte; mock segue). Único teste afetado.
- Barrel raiz **inalterado** (44 exports). Consumers internos que pegam `useCurrentTeamMember`/`useTeamMembers` via `./useTeamMembers` (useIdentity, PermissionProtectedRoute, useUserRole, PermissionsTab, Equipe) seguem na re-exportação — sem ciclo (verificado).

## Resultado (dep-cruise)
- Baseline **56 → 55** (`no-circular` 33 → 32). Removido EXATAMENTE 1: `no-circular | useOrganization.ts → useTeamMembers.ts`. **0 adicionados** (provado por diff de chaves HEAD vs novo baseline). Baseline regenerado (`lint:deps:baseline`) — permitido por ser redução, justificado aqui.
- `useOrganization`/`useTeamMembers`/`useCurrentTeamMember` agora em **zero ciclos** (depcruise live = 55, nenhum tocando esses arquivos). **9.4 (move) fica ratchet-neutro.**

## Validação (output literal — 2026-06-01, sobre develop pós-9.3 #606)
- `grep -c '^export' identity/index.ts` = **44** (inalterado)
- `npx tsc --noEmit` (root) = **0 erros**
- `npm run lint` = **0 errors** / 2543 warnings (pré-existentes)
- `node scripts/dep-cruise-ratchet.cjs` = **OK — baseline 55** (0 new; regen 56→55 só removeu o ciclo)
- `npm run test:unit` = **23 failed | 315 passed | 3 skipped** files · **38 failed | 4223 passed | 150 skipped** tests — red set 100% pré-existente. Subset org/team/identity (use-team-members, hooks-sprint2-team-members, use-identity, use-user-role, use-feature-permissions-orgid) = **5 files / 46 tests pass**; `use-organization` = **12/12 pass** (após fix do mock).

## Segurança (área frágil — org context)
`useOrganization` provê o `organization_id` de TODA query (multi-tenancy). Extração não alterou lógica: bodies movidos verbatim, mesma resolução de org/team_member/master-virtual. Smoke obrigatório: login → org resolve → switch de org re-filtra (gate CTO).

## Próximo
9.4 (move): `org-team/` + `master/` internos + DEMOTE master barrel (44→~33). Agora ratchet-neutro (ciclo morto). PR separado.
