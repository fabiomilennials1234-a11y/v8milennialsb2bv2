import { useQuery } from "@tanstack/react-query";
import { getMessageLimits } from "@/modules/communication/lib/whatsappApi";

export function useMessageLimits(
  instanceId: string | null,
  organizationId?: string
) {
  return useQuery({
    queryKey: ["whatsapp_message_limits", instanceId, organizationId ?? null],
    queryFn: () => getMessageLimits(instanceId!, organizationId),
    enabled: !!instanceId,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}
