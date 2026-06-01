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

// ── Hooks: master ops ──────────────────────────────────────────────────────
export { useMasterAuth, useCanAccessMaster } from "./hooks/useMasterAuth";
export type { MasterUser, MasterPermissions } from "./hooks/useMasterAuth";
export {
  useOperationsOverview,
  useAutomationJobs,
  useJobsOverview,
  useRetryDeadLetter,
  useRuntimeLogs,
  useUsageByOrg,
} from "./hooks/useMasterOperations";
export type {
  AutomationJob,
  JobsOverview,
  OperationsOverview,
  RuntimeLog,
  UsageByOrg,
} from "./hooks/useMasterOperations";
export {
  useMasterOrganizations,
  useMasterOrganization,
  useMasterOrganizationMembers,
  useMasterOrganizationStats,
  useMasterCreateOrganization,
  useMasterUpdateOrganization,
  useMasterDeleteOrganization,
  useMasterBillingOverride,
} from "./hooks/useMasterOrganizations";
export type {
  MasterOrganization,
  OrganizationStats,
} from "./hooks/useMasterOrganizations";
export { useMasterPlans, useUpdatePlan } from "./hooks/useMasterPlans";
export type { Plan } from "./hooks/useMasterPlans";
export {
  useMasterUsers,
  useMasterUserStats,
  useMasterUnassignedUsers,
  useMasterAssignUserToOrg,
  useMasterMoveUserToOrg,
  useMasterChangeUserRole,
  useMasterToggleUserActive,
  useMasterUpdateUser,
  useMasterResetUserPassword,
} from "./hooks/useMasterUsers";
export type {
  MasterUserView,
  UnassignedUser,
  UserStats,
} from "./hooks/useMasterUsers";
export {
  useMasterAuditLogs,
  useMasterAuditActions,
  useMasterAuditStats,
} from "./hooks/useMasterAuditLogs";
export type { AuditLog, AuditLogFilters } from "./hooks/useMasterAuditLogs";

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

// ── Hooks: organization + settings ─────────────────────────────────────────
export { useOrganization, useRequiredOrganization } from "./hooks/useOrganization";
export type { OrgType, OrganizationContext } from "./hooks/useOrganization";
export {
  useOrganizationSettings,
  useConfirmacaoOverdueDays,
  isConfirmacaoOverdue,
} from "./hooks/useOrganizationSettings";
export type { OrganizationSettings } from "./hooks/useOrganizationSettings";
export { useOrgQuotas } from "./hooks/useOrgQuotas";
export type { QuotaInfo } from "./hooks/useOrgQuotas";
export { useOrgSwitcher } from "./hooks/useOrgSwitcher";
export type { SwitcherOrg } from "./hooks/useOrgSwitcher";
export { useSeatUsage } from "./hooks/useSeatUsage";
export type { SeatUsage } from "./hooks/useSeatUsage";

// ── Hooks: team + profile ──────────────────────────────────────────────────
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
} from "./hooks/useTeamMembers";
export type {
  TeamMember,
  TeamMemberInsert,
  TeamMemberUpdate,
} from "./hooks/useTeamMembers";
export { useProfile, useProfiles } from "./hooks/useProfiles";
export type { Profile } from "./hooks/useProfiles";

// ── Components ─────────────────────────────────────────────────────────────
export { ProtectedRoute } from "./auth";
export { PermissionProtectedRoute } from "./permissions";
export { SubscriptionProtectedRoute } from "./components/SubscriptionProtectedRoute";
