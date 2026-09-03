import { memo } from "react";
import { useLeadSheet } from "../hooks/useLeadSheet";
import { LeadDetailDialogV2 } from "./LeadDetailDialogV2";

/**
 * Porta única do modal de lead — hoje é sempre o V2 (lead-centric com
 * `CrossPipePanel`).
 *
 * HISTÓRICO: até a SCRUM-637 este componente roteava entre V1 (split-pane
 * legado via `LeadDetailSheet`) e V2 pela flag `new_lead_modal_v2`. Medido em
 * prod 2026-09-02: 108/108 orgs com a flag LIGADA — o V1 estava inalcançável
 * e foi demolido (LeadDetailSheet, LeadDetailFunnelContext, contexts por pipe
 * e todo o séquito). A telemetria `lead_modal_version_rendered` morreu junto:
 * só existia para medir o rollout, e o rollout acabou.
 */
export const LeadDetailDialog = memo(function LeadDetailDialog() {
  const { isOpen } = useLeadSheet();

  if (!isOpen) return null;
  return <LeadDetailDialogV2 />;
});
