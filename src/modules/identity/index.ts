/**
 * Module identity — API pública.
 *
 * Tudo que outros módulos consomem deve estar exportado aqui.
 * Internals (subpastas) são privados — não importar de fora via path interno.
 *
 * Boundary enforcement: warn agora (slice 1), error em slice 17.
 * Ver `CLAUDE.md` deste módulo para escopo, áreas frágeis e owner.
 */

// ── Auth context ───────────────────────────────────────────────────────────
export { AuthProvider, useAuth } from "./auth";

// ── Lib (permissions resolver) ─────────────────────────────────────────────
export {
  resolveAction,
  usePermission,
  assertPermissionClient,
  assertPermission,
} from "./permissions";
export type {
  AppAction,
  ResolveActionContext,
  ResolveActionResult,
} from "./permissions";

// ── Hooks: identity + role ─────────────────────────────────────────────────
export { useIdentity } from "./auth";
export type { Identity } from "./auth";
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
} from "./permissions";
export type { AppRole, UserRole } from "./permissions";
export { useCanDo } from "./permissions";

// ── Hooks: master ops (sub-conceito master/ — só o entry público fica no barrel; resto em master/index.ts, slice 9.4) ──
export { useMasterAuth, useCanAccessMaster } from "./master";

// ── Hooks: permissions (granular) ──────────────────────────────────────────
export {
  useHasPermission,
  useMyPermissions,
  useOrganizationRolePermissions,
  useTeamMemberOrgPermissions,
  useSaveTeamMemberOrgPermissions,
  PERMISSION_LABELS,
} from "./permissions";
export type {
  PermissionKey,
  TeamMemberOrgPermission,
} from "./permissions";
export { useOrgRolePermissions } from "./permissions";
export type { OrgRolePermissionsMap } from "./permissions";
export { useUpdateRolePermission } from "./permissions";
export type { UpdateRolePermissionInput } from "./permissions";
export { useResetOrgRolePermissions } from "./permissions";

// ── Hooks: organization + settings (sub-conceito org-team/ — slice 9.4b) ────
export { useOrganization, useRequiredOrganization } from "./org-team";
export type { OrgType, OrganizationContext } from "./org-team";
export {
  useOrganizationSettings,
  useConfirmacaoOverdueDays,
  isConfirmacaoOverdue,
} from "./org-team";
export type { OrganizationSettings } from "./org-team";
export { useOrgQuotas } from "./org-team";
export type { QuotaInfo } from "./org-team";
export { useOrgSwitcher } from "./org-team";
export type { SwitcherOrg } from "./org-team";
export { useSeatUsage } from "./org-team";
export type { SeatUsage } from "./org-team";

// ── Hooks: team + profile (sub-conceito org-team/ — slice 9.4b) ─────────────
export {
  useTeamMembers,
  useTeamMember,
  useCurrentTeamMember,
  useResponsibleMembers,
  useCreateTeamMember,
  useUpdateTeamMember,
  useDeleteTeamMember,
  getSelectedOrgId,
  setSelectedOrgId,
  isVirtualTeamMember,
} from "./org-team";
export type {
  TeamMember,
  TeamMemberInsert,
  TeamMemberUpdate,
} from "./org-team";
export { useProfile, useProfiles } from "./org-team";
export type { Profile } from "./org-team";

// ── Components ─────────────────────────────────────────────────────────────
export { ProtectedRoute } from "./auth";
export { PermissionProtectedRoute } from "./permissions";
export { SubscriptionProtectedRoute } from "./components/SubscriptionProtectedRoute";
