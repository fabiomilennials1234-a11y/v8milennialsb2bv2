/**
 * Lead Detail — modal centralizado redesenhado (2026-05-17).
 *
 * `LeadDetailDialog` substitui `LeadDetailSheet` (split-pane lateral legado).
 * Mantém alias `LeadDetailSheet = LeadDetailDialog` para minimizar churn nos
 * call sites enquanto migramos.
 *
 * Provider e hook permanecem com mesma API: `openLead(id, variant, pipeData?)`.
 */

export { LeadDetailDialog } from "./modal/LeadDetailDialog";
export { LeadDetailDialog as LeadDetailSheet } from "./modal/LeadDetailDialog";
export { LeadPanelProvider, useLeadSheet } from "./hooks/useLeadSheet";
export type { DrawerVariant } from "./hooks/useLeadSheet";
