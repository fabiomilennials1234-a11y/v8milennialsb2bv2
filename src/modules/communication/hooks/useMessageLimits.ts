import { useQuery } from "@tanstack/react-query";
import { getMessageLimits } from "@/modules/communication/lib/whatsappApi";

export function useMessageLimits(instanceId: string | null) {
  return useQuery({
    queryKey: ["whatsapp_message_limits", instanceId],
    queryFn: () => getMessageLimits(instanceId!),
    enabled: !!instanceId,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}
