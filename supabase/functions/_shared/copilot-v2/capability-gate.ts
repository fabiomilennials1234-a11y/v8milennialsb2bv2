/**
 * capability-gate + tool-call budget — Copilot v2 guardrails (Slice 2/5).
 *
 * ADR-0002 #1 + #7. Server-side enforcement: the LLM is never trusted to respect
 * a flag. Write tools are gated by their capability; read/introspect tools are
 * always allowed. Unknown tools and missing capability flags fail CLOSED. The
 * tool-call budget bounds the multi-step loop (default 5) so a turn can never
 * spin indefinitely — at the ceiling we stop and return to the lead.
 */

export type ReadTool =
  | "get_lead_360"
  | "get_contact_status"
  | "get_conversation_history"
  | "list_pipeline_stages"
  | "list_custom_fields"
  | "search_knowledge"
  | "check_agenda_availability";

export type WriteTool =
  | "move_lead_stage"
  | "schedule_meeting"
  | "set_qualification_tier"
  | "fill_lead_field"
  | "send_media"
  | "transfer_to_human"
  | "handoff_to_vendedor";

/** Maps each write tool to the capability flag that must be on. */
const WRITE_TOOL_CAPABILITY: Record<WriteTool, string> = {
  move_lead_stage: "can_move_stage",
  schedule_meeting: "can_schedule_meeting",
  set_qualification_tier: "can_set_tier",
  fill_lead_field: "can_fill_field",
  send_media: "can_send_media",
  transfer_to_human: "can_transfer",
  handoff_to_vendedor: "can_handoff",
};

const READ_TOOLS = new Set<string>([
  "get_lead_360",
  "get_contact_status",
  "get_conversation_history",
  "list_pipeline_stages",
  "list_custom_fields",
  "search_knowledge",
  "check_agenda_availability",
]);

export const TOOL_CALL_BUDGET = 5;

/** Read/introspect tools are never capability-gated nor introspect-guarded. */
export function isReadTool(tool: string): boolean {
  return READ_TOOLS.has(tool);
}

export interface CapabilityGateInput {
  tool: string;
  capabilities: Record<string, boolean | undefined>;
}

export interface CapabilityGateDecision {
  allowed: boolean;
  reason: "capability_off" | "unknown_tool" | null;
}

export function decideCapabilityGate(input: CapabilityGateInput): CapabilityGateDecision {
  if (READ_TOOLS.has(input.tool)) {
    return { allowed: true, reason: null };
  }
  const capabilityFlag = WRITE_TOOL_CAPABILITY[input.tool as WriteTool];
  if (!capabilityFlag) {
    return { allowed: false, reason: "unknown_tool" };
  }
  if (input.capabilities[capabilityFlag] === true) {
    return { allowed: true, reason: null };
  }
  return { allowed: false, reason: "capability_off" };
}

export interface ToolCallBudgetInput {
  callsThisTurn: number;
  max?: number;
}

export interface ToolCallBudgetDecision {
  allowed: boolean;
  reason: "budget_exceeded" | null;
}

export function decideToolCallBudget(input: ToolCallBudgetInput): ToolCallBudgetDecision {
  const max = input.max ?? TOOL_CALL_BUDGET;
  if (input.callsThisTurn >= max) {
    return { allowed: false, reason: "budget_exceeded" };
  }
  return { allowed: true, reason: null };
}
