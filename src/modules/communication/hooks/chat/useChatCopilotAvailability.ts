import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ChatCopilotAvailability = "loading" | "available" | "unavailable" | "error";

/** A permissão do lead não prova que a organização tem um Copilot pronto. */
export function useChatCopilotAvailability(
  organizationId: string | null | undefined,
): ChatCopilotAvailability {
  const query = useQuery({
    // As mutations do Copilot já invalidam este prefixo ao ativar/remover agentes.
    queryKey: ["copilot_agents", "chat-availability", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("copilot_agents")
        .select("id, is_active, finalized_at")
        .eq("organization_id", organizationId!);
      if (error) throw error;
      return (data ?? []).some((agent) => agent.is_active === true && !!agent.finalized_at);
    },
    enabled: !!organizationId,
    staleTime: 30_000,
    // Também observa alterações feitas por outro operador, sem uma assinatura
    // Realtime em tabela que pode não estar na publication.
    refetchInterval: 30_000,
    refetchOnWindowFocus: "always",
  });

  if (!organizationId) return "unavailable";
  // Até um refetch que falha com dado antigo em cache deixa o estado incerto.
  if (query.isError) return "error";
  if (query.data === undefined) return "loading";
  return query.data ? "available" : "unavailable";
}
