import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { parseTothPreorderWorkspace } from "../lib/toth-preorder-status";

type PreorderRpcError = { code?: string; message?: string };

// Local read-only RPC. This bridge is removed only after deployed schema types
// are regenerated. No credentials, remote ERP transport or send RPC is exposed.
const preorderClient = supabase as unknown as {
  rpc(name: "toth_preorder_workspace", args: { p_deal_id: string }): PromiseLike<{
    data: unknown; error: PreorderRpcError | null;
  }>;
};

export class TothPreorderReadError extends Error {
  constructor(message: string, readonly kind: "access_denied" | "failure") {
    super(message);
    this.name = "TothPreorderReadError";
  }
}

export function useTothPreorder(dealId: string) {
  const { organizationId, teamMemberId, isReady } = useOrganization();
  const enabled = isReady && !!organizationId && !!teamMemberId && !!dealId;
  const query = useQuery({
    queryKey: ["toth-preorder-workspace", organizationId, teamMemberId, dealId],
    queryFn: async () => {
      let response: Awaited<ReturnType<typeof preorderClient.rpc>>;
      try {
        response = await preorderClient.rpc("toth_preorder_workspace", { p_deal_id: dealId });
      } catch {
        throw new TothPreorderReadError("Não foi possível consultar a situação do pré-pedido.", "failure");
      }
      if (response.error?.code === "PGRST202" || response.error?.code === "42883") return null;
      if (response.error) {
        if (["42501", "PGRST301", "PGRST302"].includes(response.error.code ?? "") || response.error.message?.includes("toth_access_denied")) {
          throw new TothPreorderReadError("Você não tem acesso à situação deste pré-pedido.", "access_denied");
        }
        throw new TothPreorderReadError("Não foi possível consultar a situação do pré-pedido.", "failure");
      }
      const workspace = parseTothPreorderWorkspace(response.data);
      if (!workspace) throw new TothPreorderReadError("O servidor não retornou uma situação válida para o pré-pedido.", "failure");
      return workspace;
    },
    enabled,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
  });
  return { query, enabled };
}
