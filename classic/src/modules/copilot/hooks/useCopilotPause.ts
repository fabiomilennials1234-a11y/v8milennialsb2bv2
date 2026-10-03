/**
 * useCopilotPause — lê estado de pausa humana (human_paused_until) de uma conversa.
 *
 * Quando um humano envia mensagem manual, o copilot pausa por N minutos
 * (configurado em copilot_agents.human_pause_duration_minutes).
 * Este hook lê o timestamp de pausa, computa se ainda está ativo,
 * e expõe reactivate via RPC clear_human_pause.
 *
 * Realtime: invalida via useRealtimeSubscription em conversations.
 * Fallback: polling a cada 30s.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";

export interface CopilotPauseState {
  isPaused: boolean;
  pausedUntil: Date | null;
  reactivate: () => void;
  isReactivating: boolean;
}

export function useCopilotPause(params: {
  conversationId?: string | null;
  organizationId?: string | null;
}): CopilotPauseState {
  const queryClient = useQueryClient();
  const { conversationId, organizationId } = params;

  const queryKey = ["copilot-pause", conversationId];

  // Query conversation's human_paused_until
  const { data } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!conversationId) return null;
      const { data, error } = await (supabase.from as any)("conversations")
        .select("human_paused_until")
        .eq("id", conversationId)
        .single();
      if (error) return null;
      return data?.human_paused_until ?? null;
    },
    enabled: !!conversationId,
    refetchInterval: 30_000,
  });

  // Realtime subscription — invalidates copilot-pause query on conversations change
  useRealtimeSubscription("conversations", queryKey);

  // Reactivate mutation — clears pause via RPC
  const mutation = useMutation({
    mutationFn: async () => {
      if (!conversationId) throw new Error("No conversation");
      const { error } = await (supabase.rpc as any)("clear_human_pause", {
        p_conversation_id: conversationId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const pausedUntil = data ? new Date(data) : null;
  const isPaused = pausedUntil !== null && pausedUntil > new Date();

  return {
    isPaused,
    pausedUntil: isPaused ? pausedUntil : null,
    reactivate: () => mutation.mutate(),
    isReactivating: mutation.isPending,
  };
}
