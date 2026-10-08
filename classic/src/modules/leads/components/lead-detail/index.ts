/**
 * Lead Detail — modal lead-centric (PRD #284, pós-#300 + #301).
 *
 * API pública: `openLead(leadId, defaultExpandedPipeEntryId?)` + `close()`
 * via `useLeadSheet()`. `DrawerVariant` e `pipeData` foram eliminados;
 * callers que precisavam abrir num pipe específico passam só a entry id
 * desse pipe — o `CrossPipePanel` (V2) expande a section.
 *
 * `LeadDetailDialog` é hoje sempre o V2: o router por flag
 * `new_lead_modal_v2` e todo o trilho V1 (LeadDetailSheet split-pane,
 * contexts por pipe) foram demolidos na SCRUM-637 — 108/108 orgs já estavam
 * no V2 (medido em prod 2026-09-02).
 */

export { LeadDetailDialog } from "./modal/LeadDetailDialog";
export { LeadDetailDialog as LeadDetailSheet } from "./modal/LeadDetailDialog";
export { LeadDetailDialogV2 } from "./modal/LeadDetailDialogV2";
export { LeadPanelProvider, useLeadSheet } from "./hooks/useLeadSheet";
