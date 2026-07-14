/**
 * Sub-conceito org-team — API interna privada do módulo identity (slice 9.4b arch-deepening).
 *
 * Organization context + settings + quotas + seats + team members + profiles.
 * `useOrganization` provê o `organization_id` raiz de TODA query (multi-tenancy) —
 * área frágil: nunca contornar este filtro.
 *
 * Re-exportado pelo barrel raiz (`../index.ts`) — org-team é superfície PÚBLICA.
 * Não importar de fora via path interno (exceto App.tsx/pages — code-splitting).
 * Espelha os sub-conceitos auth/permissions/master.
 */

// ── Organization context + settings ────────────────────────────────────────
export { useOrganization, useRequiredOrganization } from "./hooks/useOrganization";
export type { OrgType, OrganizationContext } from "./hooks/useOrganization";
export {
  useOrganizationSettings,
  useConfirmacaoOverdueDays,
  isConfirmacaoOverdue,
} from "./hooks/useOrganizationSettings";
export type { OrganizationSettings } from "./hooks/useOrganizationSettings";
export { useAutoCreateLeadSetting } from "./hooks/useAutoCreateLeadSetting";
export type { AutoCreateLeadSetting } from "./hooks/useAutoCreateLeadSetting";
export { useAutoDistributeSetting } from "./hooks/useAutoDistributeSetting";
export type { AutoDistributeSetting } from "./hooks/useAutoDistributeSetting";

// ── Quotas + seats ─────────────────────────────────────────────────────────
export { useOrgQuotas } from "./hooks/useOrgQuotas";
export type { QuotaInfo } from "./hooks/useOrgQuotas";
export { useOrgSwitcher } from "./hooks/useOrgSwitcher";
export type { SwitcherOrg } from "./hooks/useOrgSwitcher";
export { useSeatUsage } from "./hooks/useSeatUsage";
export type { SeatUsage } from "./hooks/useSeatUsage";

// ── Team members + profiles ────────────────────────────────────────────────
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
