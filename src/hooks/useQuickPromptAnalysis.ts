import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface QuickAnalysisParams {
  agentId: string;
  conversationId: string;
}

interface QuickAnalysisResult {
  analysis_id: string | null;
  suggestions: Array<{
    id: string;
    section: string;
    type: "add" | "rewrite" | "remove";
    field: string;
    current_text: string | null;
    suggested_text: string;
    reason: string;
    evidence: string[];
    confidence: number;
  }>;
  conversation_count: number;
  message_count: number;
}

export function useQuickPromptAnalysis() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ agentId, conversationId }: QuickAnalysisParams): Promise<QuickAnalysisResult> => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not authenticated");

      const res = await supabase.functions.invoke("analyze-copilot-prompt", {
        body: { agent_id: agentId, conversation_id: conversationId },
      });

      if (res.error) throw res.error;
      const body = res.data as any;

      if (body.error) throw new Error(body.error);

      return body as QuickAnalysisResult;
    },
    onSuccess: (_data, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["prompt_analyses", agentId] });
    },
  });
}
