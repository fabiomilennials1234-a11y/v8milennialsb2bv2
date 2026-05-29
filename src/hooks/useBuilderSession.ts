/**
 * useBuilderSession
 *
 * Reads the persistent Builder Session for an agent and sends turns to the
 * copilot-builder edge function. The conversation survives across visits, so
 * the user can reopen the Builder and continue revising. (PRD #544 / #545)
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface BuilderMessage {
  role: "user" | "assistant";
  content: string;
}

interface BuilderSessionRow {
  id: string;
  messages: BuilderMessage[];
  covered_topics: string[] | null;
}

export function useBuilderSession(agentId?: string) {
  const queryClient = useQueryClient();
  const queryKey = ["builder_session", agentId];

  const sessionQuery = useQuery({
    queryKey,
    enabled: !!agentId,
    queryFn: async (): Promise<BuilderSessionRow | null> => {
      if (!agentId) return null;
      const { data, error } = await supabase
        .from("builder_sessions")
        .select("id, messages, covered_topics")
        .eq("agent_id", agentId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        messages: Array.isArray(data.messages) ? (data.messages as BuilderMessage[]) : [],
        covered_topics: data.covered_topics ?? [],
      };
    },
  });

  const sendMessage = useMutation({
    mutationFn: async (message: string): Promise<{ reply: string }> => {
      if (!agentId) throw new Error("agentId obrigatório");
      const { data, error } = await supabase.functions.invoke("copilot-builder", {
        body: { agentId, message },
      });
      if (error) throw error;
      return data as { reply: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    messages: sessionQuery.data?.messages ?? [],
    coveredTopics: sessionQuery.data?.covered_topics ?? [],
    isLoading: sessionQuery.isLoading,
    sendMessage,
  };
}
