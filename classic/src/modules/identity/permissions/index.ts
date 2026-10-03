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
// (Hooks org-wide do Pitstop > Permissões removidos em 2026-07-02: consultavam
//  organization_role_permissions/team_member_org_permissions — DROPADAS na
//  consolidação PRD #408. Superfície viva do modelo consolidado: Equipe >
//  MemberPermissions sobre member_feature_permissions + feature_permissions.)
export {
  useHasPermission,
  useMyPermissions,
  PERMISSION_LABELS,
} from "./hooks/usePermissions";
export type { PermissionKey } from "./hooks/usePermissions";

// ── Components ─────────────────────────────────────────────────────────────
export { PermissionProtectedRoute } from "./components/PermissionProtectedRoute";
