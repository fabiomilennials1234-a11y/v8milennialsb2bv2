import { useFeatureFlag } from "@/modules/platform/feature-flags";
import {
  TothOrderDraftPanel,
  TOTH_ORDER_DRAFTS_FLAG,
  TOTH_ORDER_PILOT_ORG_ID,
  isTothOrderDraftPilot,
} from "@/modules/integrations/toth-order-drafts";

/** A autorização efetiva continua no servidor; o recorte evita consultas fora do piloto. */
export function TothOrderDraftSlot({ dealId, organizationId }: {
  dealId: string;
  organizationId: string | null | undefined;
}) {
  if (organizationId !== TOTH_ORDER_PILOT_ORG_ID) return null;
  return <PilotDraft dealId={dealId} organizationId={organizationId} />;
}

function PilotDraft({ dealId, organizationId }: { dealId: string; organizationId: string }) {
  const flag = useFeatureFlag(TOTH_ORDER_DRAFTS_FLAG);
  if (flag.isLoading || !isTothOrderDraftPilot(organizationId, flag.enabled)) return null;
  return <TothOrderDraftPanel key={dealId} dealId={dealId} />;
}
