import { memo, useEffect } from "react";
import { useFeatureFlag } from "@/modules/platform/hooks/useFeatureFlag";
import { useOrganization } from "@/modules/identity";
import { useLeadSheet } from "../hooks/useLeadSheet";
import { track } from "@/lib/analytics";
import { LeadDetailDialogV1 } from "./LeadDetailDialogV1";
import { LeadDetailDialogV2 } from "./LeadDetailDialogV2";

/**
 * Router entre o modal V1 (legado split-pane via `LeadDetailSheet`) e o V2
 * (lead-centric com `CrossPipePanel`).
 *
 * Critério: `useFeatureFlag("new_lead_modal_v2")` consulta
 * `organizations.feature_flags` da org atual. Default false → V1.
 *
 * Enquanto a flag está carregando, renderiza V1 (fail-closed para o legado
 * para evitar flash do modal novo numa org que não habilitou).
 *
 * Telemetria: `lead_modal_version_rendered` dispara uma vez por abertura
 * (quando isOpen vira true), com `{ version: "v1" | "v2" }` em metadata.
 */
export const LeadDetailDialog = memo(function LeadDetailDialog() {
  const { isOpen } = useLeadSheet();
  const flag = useFeatureFlag("new_lead_modal_v2");
  const { organizationId } = useOrganization();

  const version: "v1" | "v2" = flag.enabled && !flag.isLoading ? "v2" : "v1";

  useEffect(() => {
    if (!isOpen || !organizationId || flag.isLoading) return;
    track({
      event: "lead_modal_version_rendered",
      organizationId,
      metadata: { version },
    });
  }, [isOpen, organizationId, flag.isLoading, version]);

  if (!isOpen) return null;
  return version === "v2" ? <LeadDetailDialogV2 /> : <LeadDetailDialogV1 />;
});
