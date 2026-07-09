/**
 * Sub-conceito permissions — API interna privada do módulo identity.
 * Re-exportado pelo barrel raiz identity/index.ts. Não importar de fora via path interno
 * (exceto App.tsx/pages — code-splitting). Slice 9.3 arch-deepening.
 */

// ── Lib (permissions resolver) ─────────────────────────────────────────────
export {
  resolveAction,
  usePermission,
  assertPermissionClient,
  assertPermission,
} from "./lib/permissions";
export type {
  AppAction,
  ResolveActionContext,
  ResolveActionResult,
} from "./lib/permissions";

// ── Hooks: role ────────────────────────────────────────────────────────────
export {
  useUserRole,
  useHasRole,
  useIsAdmin,
  useFeaturePermission,
  useFeaturePermissions,
  useCanManageCopilot,
  useCanManageWhatsApp,
  useJobTitle,
  useMetricType,
} from "./hooks/useUserRole";
export type { AppRole, UserRole } from "./hooks/useUserRole";
export { useCanDo } from "./hooks/useCanDo";

// ── Hooks: permissions (granular) ──────────────────────────────────────────
export {
  useHasPermission,
  useMyPermissions,
  useOrganizationRolePermissions,
  useTeamMemberOrgPermissions,
  useSaveTeamMemberOrgPermissions,
  PERMISSION_LABELS,
} from "./hooks/usePermissions";
export type {
  PermissionKey,
  TeamMemberOrgPermission,
} from "./hooks/usePermissions";
export { useOrgRolePermissions } from "./hooks/useOrgRolePermissions";
export type { OrgRolePermissionsMap } from "./hooks/useOrgRolePermissions";
export { useUpdateRolePermission } from "./hooks/useUpdateRolePermission";
export type { UpdateRolePermissionInput } from "./hooks/useUpdateRolePermission";
export { useResetOrgRolePermissions } from "./hooks/useResetOrgRolePermissions";

// ── Components ─────────────────────────────────────────────────────────────
export { PermissionProtectedRoute } from "./components/PermissionProtectedRoute";
