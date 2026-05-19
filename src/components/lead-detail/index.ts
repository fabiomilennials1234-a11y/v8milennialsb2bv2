/**
 * Lead Detail — modal lead-centric (PRD #284, pós-#300).
 *
 * API pública: `openLead(leadId, defaultExpandedPipeEntryId?)` + `close()`
 * via `useLeadSheet()`. `DrawerVariant` e `pipeData` foram eliminados;
 * callers que precisavam abrir num pipe específico agora passam só a
 * entry id desse pipe — o `LeadCrossPipeAccordion` expande a section
 * correspondente.
 */

export { LeadDetailDialog } from "./modal/LeadDetailDialog";
export { LeadDetailDialog as LeadDetailSheet } from "./modal/LeadDetailDialog";
export { LeadPanelProvider, useLeadSheet } from "./hooks/useLeadSheet";
