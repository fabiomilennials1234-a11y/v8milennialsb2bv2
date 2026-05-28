# Module — identity

**Status:** 🟡 Skeleton (slice 3 popula)
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

## Não-escopo

- UI de chat/comunicação → `communication`
- Onboarding flow do produto → `platform`
- Billing/subscription → `billing`
- Settings de feature flags → `platform`

## API pública (`index.ts`) — TBD slice 3

Provável superfície:
- Hooks: `useIdentity`, `useUserRole`, `useMasterAuth`, `useCanPerformAction`, `usePermissions`
- Components: `<ProtectedRoute>`, `<PermissionProtectedRoute>`, `<SubscriptionProtectedRoute>`
- Types: `Role`, `Permission`, `TeamMember`
- Eventos (post slice 19): `user.signed_in`, `org.switched`, `permission.granted`

## Áreas frágeis

🟠 Permissões em 3 camadas, issues recorrentes (`08 — Backlog/backlog/permissions-fallback-fail-closed.md`).

- Server-side enforcement parcial (ver `docs/PERMISSION-ENFORCEMENT.md`)
- Roles no código: SEMPRE `admin`, `master`, `membro` — nunca `SDR`/`Closer` (UI only)
- Multi-tenancy: toda query filtra `organization_id` via RLS — frontend nunca envia
- RLS + Realtime: usar `get_my_organization_ids()` (SECURITY DEFINER), NUNCA subquery inline em policies

## Origem (pastas atuais que migrarão pra cá)

Frontend:
- `src/components/master/`
- `src/components/settings/equipe/`
- `src/hooks/auth/` (subpasta existente)
- `src/hooks/useIdentity.ts`, `useUserRole.ts`, `useMasterAuth.ts`, `useMasterOperations.ts`, `useMasterOrganizations.ts`, `useMasterPlans.ts`, `useMasterUsers.ts`, `useMasterAuditLogs.ts`
- `src/hooks/usePermissions.ts`, `useCanDo.ts`, `useOrgRolePermissions.ts`, `useUpdateRolePermission.ts`, `useResetOrgRolePermissions.ts`
- `src/hooks/useOrganization.ts`, `useOrganizationSettings.ts`, `useOrgQuotas.ts`, `useOrgSwitcher.ts`, `useSeatUsage.ts`, `useTeamMembers.ts`, `useProfiles.ts`
- `src/lib/permissions.ts`
- `src/contexts/AuthContext.tsx`
- `src/pages/Auth.tsx`, `Signup.tsx`, `ResetPassword.tsx`, `Equipe.tsx`, `master/`
- `src/components/PermissionProtectedRoute.tsx`, `ProtectedRoute.tsx`, `SubscriptionProtectedRoute.tsx`

Backend:
- `supabase/functions/admin-reset-user-password/`
- `supabase/functions/assign-user-to-org/`
- `supabase/functions/attach-to-org-by-pending-invite/`
- `supabase/functions/create-org-user/`
- `supabase/functions/list-organizations/`
- `supabase/functions/list-unassigned-users/`
- `supabase/functions/remove-org-member/`
- `supabase/functions/save-member-permissions/`
- `supabase/functions/get-member-permissions/`
- `supabase/functions/_shared/auth.ts` + `user-auth.ts` (consolidar)
- `supabase/functions/_shared/permission_engine.ts`, `permission-actions.ts`, `assert-permission.ts`

## Slice de migração

**Slice 3** — `feat/modularizacao/02-identity` (5h)

## Dedup pendente

- `_shared/auth.ts` vs `_shared/user-auth.ts` — auditar diff + consolidar
- `usePermissions` vs `useCanDo` — overlap (definir convenção)

## Refs

- ADR: `Obsidian/.../04 — Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md`
- Bounded contexts: `Obsidian/.../10 — Remodelagem/02-solucao/bounded-contexts.md`
- Server-side enforcement: `docs/PERMISSION-ENFORCEMENT.md`
- Áreas frágeis (vault): `02 — Arquitetura/Areas Frageis.md`
