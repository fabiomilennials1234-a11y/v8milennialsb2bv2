# Module — identity

**Status:** 🟢 Active (slice 3 + cleanup longtail slice 16 — 2026-05-28)
**BC:** identity
**Entidade primária:** Organization + Team Member + Role + Permission
**Owner:** plataforma / ops

## Escopo

Autenticação, autorização e identidade do tenant. Multi-tenancy: org context é raiz de toda query.

Inclui:
- Login, signup, reset password, sessões (Supabase Auth)
- Org switching + claim org via convite
- Team members (admin, master, membro) — SDR/Closer são roles UI, não código
- Sistema de permissões (3 camadas: master → admin → feature → role)
- Master ops (super-admin transversal a orgs)
- Avatar resolution (`useAvatarMap`)
- Auto-admin assignment em first signup (`useAutoAdminAssignment`)

## Não-escopo

- UI de chat/comunicação → `communication`
- Onboarding flow do produto → `platform`
- Billing/subscription → `billing`
- Settings de feature flags → `platform`

## Estrutura

```
src/modules/identity/
├── auth/                             # sub-conceito auth (slice 9.2 arch-deepening) — API interna privada, re-exportada pelo barrel raiz
│   ├── contexts/AuthContext.tsx      # AuthProvider + useAuth (singleton de sessão Supabase)
│   ├── hooks/useIdentity.ts          # useIdentity + type Identity
│   ├── components/ProtectedRoute.tsx # <ProtectedRoute>
│   └── index.ts                      # sub-barrel privado (4 statements / 5 símbolos)
├── permissions/                      # sub-conceito permissions (slice 9.3 arch-deepening) — API interna privada, re-exportada pelo barrel raiz
│   ├── lib/permissions.ts            # resolveAction, usePermission, assertPermissionClient, assertPermission
│   ├── hooks/useUserRole.ts          # useUserRole + role/feature hooks (useIsAdmin, useFeaturePermission(s), useCanManage*, ...)
│   ├── hooks/useCanDo.ts             # useCanDo
│   ├── hooks/usePermissions.ts       # useHasPermission, useMyPermissions, useOrganizationRolePermissions, ..., PERMISSION_LABELS
│   ├── hooks/useOrgRolePermissions.ts        # mapa agregado das 12 toggles (Pitstop > Permissões)
│   ├── hooks/useUpdateRolePermission.ts      # mutation de toggle (storage split)
│   ├── hooks/useResetOrgRolePermissions.ts   # reset bulk pro padrão
│   ├── components/PermissionProtectedRoute.tsx
│   ├── components/PermissionsTab.tsx  # Pitstop > Permissões (deep-import direto via Configuracoes p/ lazy chunk — NÃO no sub-barrel)
│   └── index.ts                      # sub-barrel privado
├── master/                           # sub-conceito master (slice 9.4 arch-deepening) — API interna privada; barrel raiz re-exporta SÓ useMasterAuth/useCanAccessMaster, resto fica aqui
│   ├── hooks/                        # 6 master hooks: useMasterAuth, useMasterOperations, useMasterOrganizations, useMasterPlans, useMasterUsers, useMasterAuditLogs (mvd de hooks/ em 9.4)
│   ├── components/                   # Master ops UI (ApiStatusTab, BillingOverrideModal, MasterLayout, MasterRoute, MasterSidebar, PlanEditor, PlanFeatureCard, QuotaManagementPanel, onboarding/)
│   ├── pages/                        # Master route components (MasterDashboard, MasterOrganizations, MasterUsers, MasterPlans, MasterFeatures, MasterAuditLogs, MasterOperations, MasterAutomationHealth, MasterWhatsAppHealth, CopilotReasoning, CopilotToggleAudit, MasterOnboarding, WhatsAppMigration) — deep-import via App.tsx p/ lazy chunk
│   └── index.ts                      # sub-barrel privado (master ops completo)
├── org-team/                         # sub-conceito org-team (slice 9.4b arch-deepening) — API interna privada, re-exportada pelo barrel raiz (superfície PÚBLICA)
│   ├── hooks/                        # 8 hooks: useOrganization (org_id raiz de TODA query — multi-tenancy), useOrganizationSettings, useOrgQuotas, useOrgSwitcher, useSeatUsage, useTeamMembers, useCurrentTeamMember, useProfiles
│   ├── components/team/              # Team management UI (MemberPermissions, SeatUsageBar, TeamMemberCard, TeamStats) — absorvidos em slice 16, mvd p/ org-team em 9.4b
│   ├── components/ProfileSettings.tsx
│   ├── pages/Equipe.tsx              # deep-import via App.tsx p/ lazy chunk
│   └── index.ts                      # sub-barrel privado (org+team+profile)
├── components/
│   └── SubscriptionProtectedRoute.tsx
├── hooks/                            # 2 hooks: useAutoAdminAssignment, useAvatarMap — org/team/profiles mvd p/ org-team/ em 9.4b, master p/ master/ em 9.4, role/permissions p/ permissions/ em 9.3, useIdentity p/ auth/ em 9.2
├── pages/                            # Auth, Signup, ResetPassword
├── index.ts                          # API pública
└── CLAUDE.md                         # este arquivo
```

## API pública (`index.ts`)

Ver `./index.ts` para superfície completa. Resumo:

**Auth context:** `AuthProvider`, `useAuth`.

**Lib (permissions resolver):** `resolveAction`, `usePermission`, `assertPermissionClient`, `assertPermission`. Types: `AppAction`, `ResolveActionContext`, `ResolveActionResult`.

**Hooks — identity + role:** `useIdentity` (+ type `Identity`), `useUserRole`, `useHasRole`, `useIsAdmin`, `useFeaturePermission`, `useFeaturePermissions`, `useCanManageCopilot`, `useCanManageWhatsApp`, `useJobTitle`, `useMetricType` (+ types `AppRole`, `UserRole`), `useCanDo`.

**Hooks — master ops (sub-conceito `master/`):** o barrel raiz re-exporta SÓ `useMasterAuth`, `useCanAccessMaster` (+ types `MasterUser`, `MasterPermissions`) via `./master` (slice 9.4 demoção). O restante (`useMasterOperations`/`useAutomationJobs`/`useJobsOverview`/`useMasterOrganizations`/`useMasterUsers`/`useMasterPlans`/`useMasterAuditLogs` + suas variantes/types) saiu do barrel raiz e vive em `master/index.ts` — consumido só pelas pages/components master internas (deep-import via App.tsx).

**Hooks — permissions:** `usePermissions`, `useOrgRolePermissions`, `useUpdateRolePermission`, `useResetOrgRolePermissions`.

**Hooks — org + team:** `useOrganization`, `useOrganizationSettings`, `useOrgQuotas`, `useOrgSwitcher`, `useSeatUsage`, `useTeamMembers`, `useProfiles`.

**Hooks (slice 16 longtail):** `useAvatarMap` (resolve avatares por user_id), `useAutoAdminAssignment` (promove primeiro user a admin se ainda não houver admin na org).

**Components:** `<ProtectedRoute>`, `<PermissionProtectedRoute>`, `<SubscriptionProtectedRoute>`, `<PermissionsTab>`, `<ProfileSettings>`, `<MemberPermissions>`, `<SeatUsageBar>`, `<TeamMemberCard>`, `<TeamStats>`. (master components em `master/components/`, deep-import via App.tsx — NÃO no barrel raiz.)

**Pages (deep-import, não no barrel):** `pages/Auth`, `pages/Signup`, `pages/ResetPassword`, `pages/Equipe`, `master/pages/*` (master, slice 9.4).

**Eventos (post slice 19):** `user.signed_in`, `org.switched`, `permission.granted`.

## Áreas frágeis

🟠 **Permissões em 3 camadas — issues recorrentes** (`08 — Backlog/backlog/permissions-fallback-fail-closed.md`).

- Server-side enforcement parcial (ver `docs/PERMISSION-ENFORCEMENT.md`)
- Roles no código: SEMPRE `admin`, `master`, `membro` — nunca `SDR`/`Closer` (UI only)
- Multi-tenancy: toda query filtra `organization_id` via RLS — frontend nunca envia
- RLS + Realtime: usar `get_my_organization_ids()` (SECURITY DEFINER), NUNCA subquery inline em policies
- Virtual master team_member id: rotinas FK não devem persistir o id virtual (ver fix `8f63435e`)

## Dependências cross-module

- `@/shared/realtime/*` — transport infra (useRealtimeChannel/Subscription/Status, mvd em slice 16)
- `@/integrations/supabase/client`, `@/integrations/supabase/types`

## Backend (NÃO migrado — fica em `supabase/functions/`)

Ver `supabase/functions/CLAUDE.md` slice 15 doc-only mapping. Edge functions identity:
- `admin-reset-user-password`, `assign-user-to-org`, `attach-to-org-by-pending-invite`, `create-org-user`, `list-organizations`, `list-unassigned-users`, `remove-org-member`, `save-member-permissions`, `get-member-permissions`
- `_shared/auth.ts` + `user-auth.ts` (consolidar)
- `_shared/permission_engine.ts`, `permission-actions.ts`, `assert-permission.ts`

## Refs

- ADR: `Obsidian/.../04 — Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md`
- Bounded contexts: `Obsidian/.../10 — Remodelagem/02-solucao/bounded-contexts.md`
- Server-side enforcement: `docs/PERMISSION-ENFORCEMENT.md`
- Áreas frágeis (vault): `02 — Arquitetura/Areas Frageis.md`
