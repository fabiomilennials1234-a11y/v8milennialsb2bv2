import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext, ToolDef, ToolResult } from "../lib/types.ts";

export interface PromptSources {
  system_prompt: unknown;
  dos: unknown;
  promptSections: unknown;
  prompt_hash: unknown;
}

function parseDos(ci: unknown): unknown {
  if (typeof ci === "string") {
    try {
      return (JSON.parse(ci) as { dos?: unknown })?.dos ?? null;
    } catch {
      return null;
    }
  }
  if (ci && typeof ci === "object") return (ci as { dos?: unknown }).dos ?? null;
  return null;
}

/**
 * The Copilot v1 prompt lives in 3 places — surface them side by side
 * (known gotcha: editing the wrong one silently diverges).
 */
export function extractPromptSources(agent: Record<string, unknown>): PromptSources {
  const style = agent.conversation_style as { promptSections?: unknown } | null | undefined;
  return {
    system_prompt: agent.system_prompt ?? null,
    dos: parseDos(agent.custom_instructions),
    promptSections: style?.promptSections ?? null,
    prompt_hash: agent.prompt_hash ?? null,
  };
}

const COLS =
  "id,organization_id,name,is_active,system_prompt,custom_instructions,conversation_style,prompt_hash";

export const copilotDumpPromptTool: ToolDef = {
  name: "copilot.dump_prompt",
  description: "Dump a Copilot agent's 3 prompt sources (system_prompt, custom_instructions.dos, " +
    "conversation_style.promptSections) + prompt_hash, RLS-scoped as master. " +
    "Provide agent_id.",
  readonly: true,
  inputSchema: {
    type: "object",
    properties: { agent_id: { type: "string", description: "Copilot agent UUID" } },
    required: ["agent_id"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const db = ctx.db as SupabaseClient;
    const { data, error } = await db.from("copilot_agents").select(COLS)
      .eq("id", String(args.agent_id)).maybeSingle();
    if (error) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
    if (!data) return { content: [{ type: "text", text: "No copilot agent found." }] };

    const payload = {
      id: data.id,
      organization_id: data.organization_id,
      name: data.name,
      is_active: data.is_active,
      sources: extractPromptSources(data),
    };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  },
};
