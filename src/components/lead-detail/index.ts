/**
 * Lead Detail — modal lead-centric (PRD #284, pós-#300 + #301).
 *
 * API pública: `openLead(leadId, defaultExpandedPipeEntryId?)` + `close()`
 * via `useLeadSheet()`. `DrawerVariant` e `pipeData` foram eliminados;
 * callers que precisavam abrir num pipe específico passam só a entry id
 * desse pipe — o `CrossPipePanel` (V2) expande a section.
 *
 * O `LeadDetailDialog` exportado é um router que escolhe entre V1 (legado
 * `LeadDetailSheet` em wrapper Dialog/Sheet) e V2 (modal redesenhado com
 * accordion cross-pipe). Critério: `useFeatureFlag("new_lead_modal_v2")`
 * por organização — default false (V1). Toggle via DB:
 *
 *   UPDATE organizations
 *      SET feature_flags = feature_flags || '{"new_lead_modal_v2": true}'::jsonb
 *      WHERE id = '<org>';
 *
 * `LeadDetailDialogV1` e `LeadDetailDialogV2` são exportados explicitamente
 * para tests e debugging — não usar em call sites de prod.
 */

export { LeadDetailDialog } from "./modal/LeadDetailDialog";
export { LeadDetailDialog as LeadDetailSheet } from "./modal/LeadDetailDialog";
export { LeadDetailDialogV1 } from "./modal/LeadDetailDialogV1";
export { LeadDetailDialogV2 } from "./modal/LeadDetailDialogV2";
export { LeadPanelProvider, useLeadSheet } from "./hooks/useLeadSheet";
