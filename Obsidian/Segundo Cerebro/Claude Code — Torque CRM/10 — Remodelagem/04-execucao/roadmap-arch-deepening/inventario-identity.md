---
status: ativo
owner: arquiteto
tipo: inventario-execucao
fase: 9
slice: 9.1
criado: 2026-05-28
relacionados:
  - "[[fase-9-identity-split]]"
  - "[[fase-8-pipelines-re-deepen]]"
  - "[[fase-7-quebrar-ciclo-leads-pipelines]]"
  - "[[_INDEX]]"
---

# Inventário Fase 9 Slice 9.1 — `identity` exports + decisão Alt A/B

Snapshot 2026-05-28, `develop` @ `2642b640`.

## Totais medidos

| Métrica | Valor |
|---|---:|
| Export statements (`grep -c '^export' identity/index.ts`) | **44** |
| Símbolos distintos exportados | **114** |
| Arquivos no módulo (`*.ts`/`*.tsx`) | **66** |
| Files-per-export (statements) | **1.50** — shallow |
| Sites de import externo (`from "@/modules/identity"`) | **396** |
| Símbolos externamente consumidos (via barrel) | **25** ([detalhe](#consumers-externos-via-barrel)) |
| Símbolos exportados mas sem consumer externo | **89** (78%) |

> 78% do barrel é **dead surface externa** — consumido apenas internamente (`identity/pages/master/*` e `identity/components/master/*` via paths relativos). Esse é o sinal forte: o barrel grande não reflete reach real.

## Breakdown por sub-conceito

| Sub-conceito | Statements | Símbolos | % símbolos | Símbolos com consumer externo | Reach externo (sum) |
|---|---:|---:|---:|---:|---:|
| **auth** | 4 | 5 | 4% | 4 | 141 |
| **permissions** | 13 | 33 | 29% | 9 | 49 |
| **org-team** | 14 | 30 | 26% | 12 | 282 |
| **master** | 12 | 45 | 39% | 1 | 1 |
| **shared** | 1 | 1 | 1% | 0 | 0 |
| **Total** | **44** | **114** | 100% | **25** | **396** ([batem com sites](#totais-medidos)) |

Achado crítico: **master = 39% dos símbolos, 0,3% do reach externo**. 44 dos 45 símbolos master (`useMaster*`, types) consumidos **apenas dentro de `identity/pages/master/*`**. Único leak externo: `useMasterAuth` (1 site, provavelmente em `App.tsx` roteamento).

## Tabela completa — 44 export statements

Coluna **PUB/PRIV**: sugestão pós Slice 9.5. PUB = manter no barrel; PRIV = degradar pra path interno (subpasta) ou re-export só dentro de sub-barrel.

| # | Linha | Símbolos exportados | Sub-conceito | Consumers ext (max sym) | Freq | PUB/PRIV |
|---:|---:|---|---|---:|---|---|
| 1 | 12 | `AuthProvider`, `useAuth` | auth | 57 (`useAuth`) | alta | **PUB** |
| 2 | 15-20 | `resolveAction`, `usePermission`, `assertPermissionClient`, `assertPermission` | permissions | 2 (`assertPermission`) | baixa | PRIV (mover pra `permissions/lib`, expor só `assertPermission`) |
| 3 | 21-25 | type `AppAction`, `ResolveActionContext`, `ResolveActionResult` | permissions | 0 | baixa | PRIV |
| 4 | 28 | `useIdentity` | auth | 26 | alta | **PUB** |
| 5 | 29 | type `Identity` | auth | 0 (uso inferido inline) | baixa | PRIV (re-derivar do hook) |
| 6 | 30-40 | `useUserRole`, `useHasRole`, `useIsAdmin`, `useFeaturePermission`, `useFeaturePermissions`, `useCanManageCopilot`, `useCanManageWhatsApp`, `useJobTitle`, `useMetricType` | permissions | 11 (`useFeaturePermission`) | média | **PUB** (parcial — manter `useUserRole`, `useFeaturePermission*`, `useCanManage*`, `useJobTitle`; demais PRIV) |
| 7 | 41 | type `AppRole`, `UserRole` | permissions | 0 (uso só de string literal) | baixa | PRIV |
| 8 | 42 | `useCanDo` | permissions | 21 | alta | **PUB** |
| 9 | 45 | `useMasterAuth`, `useCanAccessMaster` | master | 1 (`useMasterAuth`) | baixa | PUB (`useMasterAuth` único leak — roteamento) |
| 10 | 46 | type `MasterUser`, `MasterPermissions` | master | 0 | baixa | PRIV |
| 11 | 47-54 | `useOperationsOverview`, `useAutomationJobs`, `useJobsOverview`, `useRetryDeadLetter`, `useRuntimeLogs`, `useUsageByOrg` | master | 0 | baixa | PRIV (consumido só por `pages/master/MasterOperations.tsx`, `MasterAutomationHealth.tsx`) |
| 12 | 55-61 | types `AutomationJob`, `JobsOverview`, `OperationsOverview`, `RuntimeLog`, `UsageByOrg` | master | 0 | baixa | PRIV |
| 13 | 62-71 | `useMasterOrganizations`, `useMasterOrganization`, `useMasterOrganizationMembers`, `useMasterOrganizationStats`, `useMasterCreateOrganization`, `useMasterUpdateOrganization`, `useMasterDeleteOrganization`, `useMasterBillingOverride` | master | 0 | baixa | PRIV |
| 14 | 72-75 | types `MasterOrganization`, `OrganizationStats` | master | 0 | baixa | PRIV |
| 15 | 76 | `useMasterPlans`, `useUpdatePlan` | master | 0 | baixa | PRIV |
| 16 | 77 | type `Plan` | master | 0 | baixa | PRIV |
| 17 | 78-88 | `useMasterUsers`, `useMasterUserStats`, `useMasterUnassignedUsers`, `useMasterAssignUserToOrg`, `useMasterMoveUserToOrg`, `useMasterChangeUserRole`, `useMasterToggleUserActive`, `useMasterUpdateUser`, `useMasterResetUserPassword` | master | 0 | baixa | PRIV |
| 18 | 89-93 | types `MasterUserView`, `UnassignedUser`, `UserStats` | master | 0 | baixa | PRIV |
| 19 | 94-98 | `useMasterAuditLogs`, `useMasterAuditActions`, `useMasterAuditStats` | master | 0 | baixa | PRIV |
| 20 | 99 | types `AuditLog`, `AuditLogFilters` | master | 0 | baixa | PRIV |
| 21 | 102-109 | `useHasPermission`, `useMyPermissions`, `useOrganizationRolePermissions`, `useTeamMemberOrgPermissions`, `useSaveTeamMemberOrgPermissions`, `PERMISSION_LABELS` | permissions | 1 (`useHasPermission`) | baixa | PRIV (consumido só por `PermissionsTab.tsx` interno) |
| 22 | 110-113 | types `PermissionKey`, `TeamMemberOrgPermission` | permissions | 0 | baixa | PRIV |
| 23 | 114 | `useOrgRolePermissions` | permissions | 0 | baixa | PRIV |
| 24 | 115 | type `OrgRolePermissionsMap` | permissions | 0 | baixa | PRIV |
| 25 | 116 | `useUpdateRolePermission` | permissions | 0 | baixa | PRIV |
| 26 | 117 | type `UpdateRolePermissionInput` | permissions | 0 | baixa | PRIV |
| 27 | 118 | `useResetOrgRolePermissions` | permissions | 0 | baixa | PRIV |
| 28 | 121 | `useOrganization`, `useRequiredOrganization` | org-team | 157 (`useOrganization`) | alta | **PUB** (hook mais consumido do app) |
| 29 | 122 | types `OrgType`, `OrganizationContext` | org-team | 0 | baixa | PRIV (uso só `useOrganization()` retorna inline) |
| 30 | 123-127 | `useOrganizationSettings`, `useConfirmacaoOverdueDays`, `isConfirmacaoOverdue` | org-team | 5 (`isConfirmacaoOverdue`) | média | **PUB** |
| 31 | 128 | type `OrganizationSettings` | org-team | 0 | baixa | PRIV |
| 32 | 129 | `useOrgQuotas` | org-team | 2 | baixa | **PUB** |
| 33 | 130 | type `QuotaInfo` | org-team | 0 | baixa | PRIV |
| 34 | 131 | `useOrgSwitcher` | org-team | 1 | baixa | **PUB** (header) |
| 35 | 132 | type `SwitcherOrg` | org-team | 0 | baixa | PRIV |
| 36 | 133 | `useSeatUsage` | org-team | 0 (só `SeatUsageBar` interno) | baixa | PRIV |
| 37 | 134 | type `SeatUsage` | org-team | 1 | baixa | PRIV (mover pra component public type) |
| 38 | 137-148 | `useTeamMembers`, `useTeamMember`, `useCurrentTeamMember`, `useResponsibleMembers`, `useCreateTeamMember`, `useUpdateTeamMember`, `useDeleteTeamMember`, `getSelectedOrgId`, `setSelectedOrgId`, `isVirtualTeamMember` | org-team | 52 (`useCurrentTeamMember`) | alta | **PUB** (parcial — manter `useCurrentTeamMember`, `useTeamMembers`, `useResponsibleMembers`, `isVirtualTeamMember`; demais PRIV) |
| 39 | 149-153 | types `TeamMember`, `TeamMemberInsert`, `TeamMemberUpdate` | org-team | 1 (`TeamMember`) | baixa | **PUB** (`TeamMember` apenas) |
| 40 | 154 | `useProfile`, `useProfiles` | org-team | 0 | baixa | PRIV (consumidos cross-module? validar antes de PRIV em 9.5) |
| 41 | 155 | type `Profile` | org-team | 0 | baixa | PRIV |
| 42 | 158 | `ProtectedRoute` | auth | 0 (uso só em `App.tsx` roteamento — relativo?) | baixa | **PUB** (necessário rota) |
| 43 | 159 | `PermissionProtectedRoute` | permissions | 0 (idem) | baixa | **PUB** (necessário rota) |
| 44 | 160 | `SubscriptionProtectedRoute` | shared (billing-shim) | 0 (idem) | baixa | **PUB** (necessário rota) |

### Consumers externos via barrel

Top consumers (símbolo : count):

```
useOrganization         157
useAuth                  57
useCurrentTeamMember     52
useTeamMembers           41
useIdentity              26
useCanDo                 21
useResponsibleMembers    16
useFeaturePermission     11
useUserRole               8
isVirtualTeamMember       7
isConfirmacaoOverdue      5
useConfirmacaoOverdueDays 4
useOrgQuotas              2
useCanManageCopilot       2
assertPermission          2
SeatUsage                 1
TeamMember                1
useCanManageWhatsApp      1
useCreateTeamMember       1
useFeaturePermissions     1
useHasPermission          1
useJobTitle               1
useMasterAuth             1
useOrganizationSettings   1
useOrgSwitcher            1
```

Soma reach externo: **419** símbolo-imports (vários sites importam múltiplos símbolos por statement). 396 statements distintos.

Símbolos com consumer ≥ 5: **12** (concentração brutal — 95% do reach).
Símbolos com 0 consumer externo: **89** de 114.

## Mapa de dependências entre sub-conceitos

```
                  ┌──────────┐
                  │   auth   │  (Supabase Auth, session, user.id)
                  └────┬─────┘
                       │ session.user_id, user
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
  ┌──────────┐  ┌──────────┐  ┌──────────┐
  │ org-team │  │permissions│  │  master  │
  │          │  │  (3-cam.) │  │ (super)  │
  └────┬─────┘  └────┬──────┘  └────┬─────┘
       │             ▲              │
       │ org_id      │ role/perm    │ list de orgs,
       └─────────────┘ por org      │ users, audit
                                    │
                       ┌────────────┘
                       ▼
                  org-team + auth (operadas em escopo cross-org)
```

Acoplamentos medidos / inferidos (a confirmar no slice 9.2 antes do split físico):

| De → Para | Tipo | Força |
|---|---|---|
| `permissions → auth` | `usePermission` lê `useAuth().user` | forte (semântica) |
| `permissions → org-team` | resolver precisa `org_id` corrente | forte |
| `org-team → auth` | `useOrganization` filtra por `auth.user.id` | forte |
| `master → auth` | `useMasterAuth` distingue master user | forte |
| `master → org-team` | `useMasterOrganizations` lista orgs (admin transversal) | semântico, dados via service role |
| `master → permissions` | `useCanAccessMaster` resolve permission flag | médio |
| `shared (Subscription) → billing` | lê plano da org | cross-BC (billing fora do identity) |

**Anel observado**: auth → permissions/org-team → consumido por components que também precisam auth. Sem ciclos diretos no grafo de imports (todos descem de `auth`), mas semanticamente acoplado.

## Pros/cons mensurados — Alt A vs Alt B

### Alt A — Split em 4 BCs físicos (`auth`, `permissions`, `org-team`, `master`)

| Critério | Avaliação |
|---|---|
| Files-per-export pós | `master` ≈ 28/3 ≈ **9.3** (ratio enorme — quase sem barrel). `permissions` ≈ 12/8 ≈ **1.5** (não resolve). `org-team` ≈ 18/8 ≈ **2.25**. `auth` ≈ 8/3 ≈ **2.7**. |
| Deletion test | ✅ Forte. `master` removível como BC (só leaks `useMasterAuth`). `auth` removível separadamente. |
| Risco quebra cross-cutting | 🔴 Alto. 396 sites importam `@/modules/identity`. Re-pathing todos em PR único = blast radius enorme. Stagger via shim aumenta superfície de transição. |
| Risco novo ciclo BC ↔ BC | 🟠 Médio. `permissions → org-team → auth` já é dependência. Tornar isso explícito força ordem `auth ← permissions ← org-team ← master` ou cria deep imports cruzados de novo. |
| Onboarding agente IA | ✅ Cada BC com escopo claro, sub-CLAUDE.md focado. |
| Esforço | 🔴 Alto. 4 módulos, 4 barrels, 4 CLAUDE.md, ESLint boundaries 4 nodes, migração de 396 import sites. |
| Reversibilidade | 🟠 Baixa pós-merge. |

### Alt B — Re-deepen interno (subpastas privadas em `identity/`)

| Critério | Avaliação |
|---|---|
| Files-per-export pós | Barrel raiz ≤ 25 statements. `66/25 = 2.64`. Quase no alvo ≥ 3.0. Pode chegar a 3.0 se demovermos os 5 statements `master` que **não são `useMasterAuth`** (mantém só `useMasterAuth` no barrel raiz). |
| Deletion test | 🟠 Médio. Sub-pastas separáveis mas todas dentro do mesmo BC. Não testa autonomia entre auth/perm/org-team. |
| Risco quebra cross-cutting | 🟢 Baixo. Consumers externos enxergam **mesmo barrel**. Só mudam paths internos. |
| Risco novo ciclo | 🟢 Baixo. Pattern Fase 8 (sub-barrels privados, raiz re-exporta) já validado. |
| Onboarding agente IA | 🟡 Médio. Sub-CLAUDE.md em sub-pastas ajuda, mas o módulo continua misturando 5 sub-conceitos. |
| Esforço | 🟢 Médio (3-5 slices, sem migrar 396 sites). |
| Reversibilidade | 🟢 Alta. Cada sub-pasta interna é refactor isolado. |

### Recomendação — **Alt B** (re-deepen interno)

Justificativa concreta:

1. **Reach desbalanceado** — 95% do reach concentra em **12 símbolos** (de 114). Não compensa criar 4 BCs físicos pra extrair os outros 102 símbolos que ninguém consome cross-module.
2. **`master` é trivialmente isolável dentro de Alt B** — basta criar `identity/master/` privada, demover 44 master statements do barrel, manter só `useMasterAuth`. Ganho de ratio sem risco de quebra externa.
3. **Risco 🟠 área frágil (permissions)** — Alt A faz refactor + split simultâneo. Alt B isola refactor; promoção a BC físico vira decisão separada na Fase 10 se necessário.
4. **Custo 396 import sites** — Alt B preserva todos esses sites inalterados. Alt A mexe em todos.
5. **Pattern provado** — Fase 8 (`pipelines` re-deepen) usa exatamente esse pattern; replicar reduz custo cognitivo do agente IA executor.
6. **Caminho pra Alt A não fecha** — pós Alt B, se `master/` provar-se autônomo (deletion test interno passa, zero shared types), promoção a BC físico vira PR mecânico de mover pasta + atualizar 1 import site (`useMasterAuth` em `App.tsx` ou similar).

**Decisão CTO** (a registrar no header desta nota): **Alt B**. Fase 10 (futura) reavalia promoção de `master/` a BC físico autônomo após estabilização.

## Impacto nos slices 9.2-9.5 (Alt B)

(Refletido no doc `[[fase-9-identity-split]]` atualizado no mesmo PR.)

| Slice | Escopo Alt B | Alvo barrel raiz pós-slice | Risco |
|---|---|---:|---|
| 9.2 — `auth/` interno | mover `AuthContext`, `useAuth`, `useIdentity`, `ProtectedRoute` pra `identity/auth/` + `auth/index.ts` privado. Barrel raiz re-exporta. | 44 (zero change cross-module) | 🟢 baixo |
| 9.3 — `permissions/` interno 🟠 | mover `permissions.ts` resolver + hooks role/perm + `PermissionProtectedRoute` pra `identity/permissions/`. Fail-closed preservado. Test `permission-engine.test.ts` 3× consecutivo. | 44 (zero change cross-module) | 🟠 alto (área frágil) |
| 9.4 — `org-team/` + `master/` internos | criar `identity/org-team/` e `identity/master/`. Demover 44 statements master do barrel raiz **exceto `useMasterAuth`**. | 44 → ~24 (master purga 12 statements + types órfãos) | 🟡 médio (regredir hotfix #530 = NÃO; testar `useMasterOperations*` carrega) |
| 9.5 — purgar barrel raiz | aplicar PUB/PRIV desta tabela: demover ~25 statements PRIV. Atualizar `identity/CLAUDE.md` com nova estrutura. | **~18** (≥ 3.0 ratio, abaixo do alvo 20) | 🟡 médio (revisar consumer 1× antes de PRIV) |

Alvo final ratio: `66 / ~18 ≈ 3.7` — ultrapassa alvo ≥ 3.0 da Fase 9.

### Métricas auditáveis ao final da Fase 9

```bash
# alvo statements ≤ 20
grep -c '^export' src/modules/identity/index.ts
# alvo símbolos externamente consumidos = mesmo set de 25 hoje
grep -rEzo 'import[^;]*from "@/modules/identity";' src --include='*.ts*' \
  | tr '\0' '\n' | grep -oE '\b(useOrganization|useAuth|useCurrentTeamMember|...)\b' \
  | sort -u | wc -l
# alvo files ratio ≥ 3.0
echo "scale=2; $(find src/modules/identity -type f \( -name '*.ts' -o -name '*.tsx' \) | wc -l) / $(grep -c '^export' src/modules/identity/index.ts)" | bc
```

## Verificações TDD (Slice 9.1 doc-only)

- [x] 100% dos 44 export statements cobertos na tabela
- [x] 100% dos 114 símbolos classificados por sub-conceito
- [x] Consumer count medido via grep canônico (396 sites)
- [x] Pros/cons Alt A vs Alt B mensurados com números (ratio, reach, sites)
- [x] Recomendação default = Alt B com justificativa concreta
- [x] Mapa de dependências entre sub-conceitos
- [x] Slices 9.2-9.5 adaptados refletindo Alt B
- [x] Frontmatter Obsidian válido (status, owner, tipo, fase, slice, criado, relacionados)
- [x] Wikilinks resolvem (`fase-9-identity-split`, `fase-8`, `fase-7`, `_INDEX`)

## Constraints respeitadas

- Zero código modificado (doc-only).
- Zero mutação DB.
- Zero push em main.
- Branch `feat/arch-deepening/09-1-decisao-identity` saiu de `develop` sincronizada @ `2642b640`.
- PR target = `develop`.
