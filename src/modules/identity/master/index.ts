/**
 * Sub-conceito master — API interna privada do módulo identity (slice 9.4 arch-deepening).
 *
 * Master ops (super-admin transversal a orgs): auth, organizations, users, plans,
 * audit logs, operations health. Tudo aqui é privado ao módulo.
 *
 * Só o entry público (`useMasterAuth`, `useCanAccessMaster`) é re-exportado pelo
 * barrel raiz (`../index.ts`). O restante NÃO sai do módulo — consumido apenas
 * internamente pelas pages/components master (deep-import via `App.tsx` preserva
 * code-splitting `React.lazy()`).
 */

// ── Auth / access gate ─────────────────────────────────────────────────────
export { MasterOnlineIndicator } from "./components/MasterOnlineIndicator";
export { useMasterAuth, useCanAccessMaster } from "./hooks/useMasterAuth";
export type { MasterUser, MasterPermissions } from "./hooks/useMasterAuth";

// ── Operations health ──────────────────────────────────────────────────────
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

// ── Stage role review (won/lost — #991, ADR-0017 §1) ──────────────────────
export {
  useStageRoleSuggestions,
  useReviewStageRoleSuggestion,
} from "./hooks/useStageRoleSuggestions";
export type { ReviewSuggestionInput } from "./hooks/useStageRoleSuggestions";
export {
  groupSuggestionsByOrg,
  buildReviewUpdate,
} from "./lib/stage-role-review";
export type {
  StageRoleSuggestionRow,
  OrgSuggestionGroup,
  ReviewAction,
} from "./lib/stage-role-review";

// ── Organizations ──────────────────────────────────────────────────────────
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

// ── Plans ──────────────────────────────────────────────────────────────────
export { useMasterPlans, useUpdatePlan } from "./hooks/useMasterPlans";
export type { Plan } from "./hooks/useMasterPlans";

// ── Users ──────────────────────────────────────────────────────────────────
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

// ── Gestores de Portfólio (ADR-0021 §8) ────────────────────────────────────
export {
  useMasterGestores,
  useCreateGestor,
  useToggleGestorActive,
  useSetGestorOrgs,
} from "./hooks/useMasterGestores";
export type { MasterGestorView } from "./hooks/useMasterGestores";

// ── Audit logs ─────────────────────────────────────────────────────────────
export {
  useMasterAuditLogs,
  useMasterAuditActions,
  useMasterAuditStats,
} from "./hooks/useMasterAuditLogs";
export type { AuditLog, AuditLogFilters } from "./hooks/useMasterAuditLogs";

// ── Unit economics (CAC / Payback) ──────────────────────────────────────────
export { useOrgSalesSummary } from "./hooks/useOrgSalesSummary";
export type { OrgSalesSummary } from "./hooks/useOrgSalesSummary";
export {
  useOrgEconomicsInputs,
  useSaveOrgEconomicsInputs,
} from "./hooks/useOrgEconomicsInputs";
export type {
  EconomicsScenario,
  OrgEconomicsInputs,
  OrgEconomicsInputsUpsert,
} from "./hooks/useOrgEconomicsInputs";
export {
  computeCac,
  cacBands,
  computeLtv,
  computePaybacks,
  computePaybackCurve,
  computeUnitEconomics,
} from "./lib/unit-economics";
export type {
  UnitEconomicsInputs,
  UnitEconomics,
  CacResult,
  CacBands,
  PaybackResult,
  PaybackCurveResult,
  PaybackCurveMarks,
  PaybackCurvePoint,
} from "./lib/unit-economics";
// Chamados (ADR-0018). A pagina e deep-imported pelo App.tsx, como as demais.
export {
  useMasterSupportTickets,
  useMasterTicketComments,
  useTriageSupportTicket,
  useClaimSupportTicket,
  useCreateStaffComment,
} from "./hooks/useMasterSupportTickets";
export type { MasterSupportTicket, MasterTicketFilters } from "./hooks/useMasterSupportTickets";
