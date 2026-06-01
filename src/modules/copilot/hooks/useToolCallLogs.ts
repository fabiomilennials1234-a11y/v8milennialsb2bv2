import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ToolCallLog {
  id: string;
  conversation_id: string;
  organization_id: string;
  agent_id: string | null;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_output_summary: Record<string, unknown> | null;
  duration_ms: number | null;
  created_at: string;
}

export function useToolCallLogs(conversationId: string | undefined) {
  return useQuery({
    queryKey: ["agent_tool_call_logs", conversationId],
    queryFn: async () => {
      if (!conversationId) return [];
      const { data, error } = await supabase
        .from("agent_tool_call_logs" as any)
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as unknown as ToolCallLog[];
    },
    enabled: !!conversationId,
  });
}
