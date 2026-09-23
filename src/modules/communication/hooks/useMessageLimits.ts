import { useAuth } from "@/modules/identity";
import { useQuery } from "@tanstack/react-query";
import { getMessageLimits } from "@/modules/communication/lib/whatsappApi";

export function useMessageLimits(
  instanceId: string | null,
  organizationId?: string
) {
  const { user } = useAuth();
  const resolvedOrganizationId = organizationId || localStorage.getItem("selected_org_id") || undefined;
  return useQuery({
    queryKey: ["whatsapp_message_limits", instanceId, resolvedOrganizationId ?? null, user?.id ?? null],
    queryFn: () => getMessageLimits(instanceId!, resolvedOrganizationId),
    enabled: !!instanceId && !!user,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}
