import { useOrganization } from "@/modules/identity";
import { useFeatureFlag } from "@/modules/platform";
import { isVentimaisExportEnabled, VENTIMAIS_EXPORT_FLAG, VENTIMAIS_ORGANIZATION_ID } from "../lib/ventimais-export";

/** Apenas apresentação; o exportador relê a flag ao exportar. */
export function useVentimaisExportDetails() {
  const { organizationId } = useOrganization();
  const flag = useFeatureFlag(VENTIMAIS_EXPORT_FLAG);
  return { enabled: isVentimaisExportEnabled(organizationId, flag.enabled), isLoading: organizationId === VENTIMAIS_ORGANIZATION_ID && flag.isLoading };
}
