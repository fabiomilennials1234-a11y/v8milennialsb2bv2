/**
 * Module identity — API pública (barrel enxuto, slice 9.5 arch-deepening).
 *
 * Só símbolos com reach cross-module + route guards/provider públicos.
 * Internals (auth/ · permissions/ · master/ · org-team/) são sub-barris PRIVADOS —
 * não importar de fora via path interno (exceto App.tsx/pages, por code-splitting).
 * Símbolos sem consumer externo foram demovidos pros sub-barris em 9.5.
 *
 * Boundary enforcement: warn agora (slice 1), error em slice 17.
 * Ver CLAUDE.md deste módulo para escopo, áreas frágeis e owner.
 */

// ── Auth + identity ─────────────────────────────────────────────────────────
export { AuthProvider, useAuth, useIdentity } from "./auth";
export { ProtectedRoute } from "./auth";

// ── Permissions (resolver + role/feature + granular) ────────────────────────
export { assertPermission } from "./permissions";
export {
  useUserRole,
  useFeaturePermission,
  useFeaturePermissions,
  useCanManageCopilot,
  useCanManageWhatsApp,
  useJobTitle,
  useCanDo,
  useHasPermission,
} from "./permissions";
export { PermissionProtectedRoute } from "./permissions";

// ── Master ops ──────────────────────────────────────────────────────────────
export { useMasterAuth } from "./master";

// ── Gestor de Portfólio (scoped master, ADR-0021) ───────────────────────────
export { useGestor, GestorRoute } from "./gestor";
export { resolveBootRedirect } from "./auth/lib/boot-gate";
export type { BootState, BootDecision } from "./auth/lib/boot-gate";

// ── Organization + team ─────────────────────────────────────────────────────
export {
  useOrganization,
  useOrganizationSettings,
  useAutoCreateLeadSetting,
  useConfirmacaoOverdueDays,
  isConfirmacaoOverdue,
  useOrgQuotas,
  useOrgSwitcher,
  useTeamMembers,
  useCurrentTeamMember,
  useResponsibleMembers,
  useCreateTeamMember,
  isVirtualTeamMember,
} from "./org-team";
export type { TeamMember } from "./org-team";

// ── Subscription guard ──────────────────────────────────────────────────────
export { SubscriptionProtectedRoute } from "./components/SubscriptionProtectedRoute";
