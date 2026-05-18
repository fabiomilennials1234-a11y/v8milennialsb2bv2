/**
 * Tool call logger — fire-and-forget insert to agent_tool_call_logs.
 *
 * Catches all errors and logs them; never throws.
 * Used by action executor to record RAG observability data.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface ToolCallLogParams {
  conversationId: string;
  organizationId: string;
  agentId?: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolOutputSummary?: Record<string, unknown>;
  durationMs?: number;
}

export async function logToolCall(
  supabase: SupabaseClient,
  params: ToolCallLogParams,
): Promise<void> {
  try {
    const row: Record<string, unknown> = {
      conversation_id: params.conversationId,
      organization_id: params.organizationId,
      tool_name: params.toolName,
      tool_input: params.toolInput,
    };

    if (params.agentId !== undefined) row.agent_id = params.agentId;
    if (params.toolOutputSummary !== undefined) row.tool_output_summary = params.toolOutputSummary;
    if (params.durationMs !== undefined) row.duration_ms = params.durationMs;

    const { error } = await supabase.from("agent_tool_call_logs").insert(row);

    if (error) {
      console.error("[tool-call-logger] insert failed:", error);
    }
  } catch (err) {
    console.error("[tool-call-logger] unexpected error:", err);
  }
}
