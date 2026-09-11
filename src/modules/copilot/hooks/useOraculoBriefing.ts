import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useIdentity } from "@/modules/identity";
import { recordOraculoSignal } from "./useOraculoFeedback";

export interface OraculoBriefing {
  id: string;
  headline: string;
  status: "new" | "seen" | "acted";
  expires_at: string;
  local_date: string;
  bottleneck: Record<string, unknown>;
  conversation_id: string | null;
}

interface CurrentResponse { briefing: OraculoBriefing | null }
interface OpenResponse { briefing_id: string; conversa_id: string; propostas: number }

export function useOraculoBriefing() {
  const identity = useIdentity();
  const queryClient = useQueryClient();
  const queryKey = ["oraculo-briefing", identity.organizationId, identity.userId];
  const current = useQuery({
    queryKey,
    enabled: identity.isReady && !!identity.userId && !!identity.organizationId,
    staleTime: 60_000,
    queryFn: async (): Promise<OraculoBriefing | null> => {
      const { data, error } = await supabase.functions.invoke<CurrentResponse>("oraculo-briefing", {
        body: { acao: "atual", organization_id: identity.organizationId },
      });
      if (error) throw error;
      return data?.briefing ?? null;
    },
  });

  const opening = useMutation({
    mutationFn: async (briefingId: string): Promise<OpenResponse> => {
      const { data, error } = await supabase.functions.invoke<OpenResponse>("oraculo-briefing", {
        body: { acao: "abrir", briefing_id: briefingId, organization_id: identity.organizationId },
      });
      if (error || !data?.conversa_id) throw error ?? new Error("briefing_sem_conversa");
      return data;
    },
    onSuccess: (result) => {
      queryClient.setQueryData<OraculoBriefing | null>(queryKey, (briefing) => briefing
        ? { ...briefing, status: "seen", conversation_id: result.conversa_id }
        : briefing);
      if (identity.organizationId) {
        void recordOraculoSignal({
          organizationId: identity.organizationId,
          event: "briefing_opened",
          conversationId: result.conversa_id,
        }).catch(() => undefined);
      }
    },
    onError: () => toast.error("Não consegui abrir o briefing. Tente novamente."),
  });

  return {
    briefing: current.data ?? null,
    isLoading: current.isLoading,
    open: opening.mutateAsync,
    isOpening: opening.isPending,
  };
}
