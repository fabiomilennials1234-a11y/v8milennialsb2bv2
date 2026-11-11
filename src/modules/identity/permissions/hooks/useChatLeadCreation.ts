import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../auth/contexts/AuthContext";
import { useOrganization } from "../../org-team/hooks/useOrganization";
import { readChatLeadCreationAllowed } from "../lib/chatLeadCreation";

export function useChatLeadCreation() {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const query = useQuery({
    queryKey: ["chat-lead-creation", organizationId, user?.id],
    enabled: !!organizationId && !!user?.id,
    queryFn: () => readChatLeadCreationAllowed(organizationId!),
    staleTime: 0,
    refetchInterval: 30_000,
  });
  return { allowed: !!organizationId && !!user && !query.isError && query.data === true, isLoading: query.isLoading };
}
