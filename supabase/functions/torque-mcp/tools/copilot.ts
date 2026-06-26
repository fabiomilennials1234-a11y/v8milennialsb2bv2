import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext, ToolDef, ToolResult } from "../../_shared/mcp/types.ts";

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

import { runMutation } from "../../_shared/mcp/guardrails.ts";
import { auditMcpAction } from "../lib/audit.ts";
import {
  agentRowToComposeInput,
  type ComposePromptSections,
  composeSystemPrompt,
  DEFAULT_PROMPT_SECTIONS,
  mergeSections,
} from "../../_shared/copilot-prompt/index.ts";

export interface PromptSectionsInput {
  system_prompt?: string;
  dos?: string;
  promptSections?: unknown;
}

/** Build the copilot_agents update: only provided sections; prompt_hash always nulled. */
export function buildPromptUpdate(
  sections: PromptSectionsInput,
  currentConversationStyle: Record<string, unknown> | null,
): Record<string, unknown> {
  const upd: Record<string, unknown> = { prompt_hash: null };
  if (sections.system_prompt !== undefined) upd.system_prompt = sections.system_prompt;
  if (sections.dos !== undefined) upd.custom_instructions = JSON.stringify({ dos: sections.dos });
  if (sections.promptSections !== undefined) {
    upd.conversation_style = {
      ...(currentConversationStyle ?? {}),
      promptSections: sections.promptSections,
    };
  }
  return upd;
}

export const copilotUpdatePromptTool: ToolDef = {
  name: "copilot.update_prompt",
  description:
    "Update a Copilot agent's prompt across its 3 storage locations atomically + null prompt_hash " +
    "(forces re-compile). Master-JWT write. Dry-run shows the change; confirm_token to apply.",
  readonly: false,
  inputSchema: {
    type: "object",
    properties: {
      agent_id: { type: "string", description: "Copilot agent UUID" },
      system_prompt: { type: "string", description: "New compiled system prompt (optional)" },
      dos: { type: "string", description: "New custom_instructions.dos (optional)" },
      promptSections: {
        type: "object",
        description:
          "New conversation_style.promptSections (object: personality|objective|flow|products|instructions)",
      },
      confirm_token: { type: "string" },
    },
    required: ["agent_id"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const db = ctx.db as SupabaseClient;
    const agentId = String(args.agent_id);
    const sections: PromptSectionsInput = {
      system_prompt: typeof args.system_prompt === "string" ? args.system_prompt : undefined,
      dos: typeof args.dos === "string" ? args.dos : undefined,
      promptSections: args.promptSections && typeof args.promptSections === "object" &&
          !Array.isArray(args.promptSections)
        ? args.promptSections
        : undefined,
    };
    if (
      sections.system_prompt === undefined && sections.dos === undefined &&
      sections.promptSections === undefined
    ) {
      return {
        content: [{
          type: "text",
          text: "Provide at least one of system_prompt | dos | promptSections.",
        }],
        isError: true,
      };
    }

    const res = await runMutation({
      plan: async () => {
        const { data, error } = await db.from("copilot_agents")
          .select("id,organization_id,name,conversation_style").eq("id", agentId).maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) throw new Error("No copilot agent found.");
        const update = buildPromptUpdate(
          sections,
          (data.conversation_style as Record<string, unknown>) ?? null,
        );
        return {
          action: "update_prompt",
          agent_id: agentId,
          name: data.name,
          organization_id: data.organization_id,
          update,
        };
      },
      audit: (_i, plan, token) =>
        auditMcpAction(db, {
          tool: "copilot.update_prompt",
          // Trust the agent's own org (resolved in plan), never an unverified caller arg.
          org_id: String((plan as { organization_id?: unknown }).organization_id ?? ""),
          target_type: "copilot_agent",
          target_id: agentId,
          params: args,
          plan,
          confirm_token: token,
        }),
      apply: async (_i, plan) => {
        const { error } = await db.from("copilot_agents").update(
          (plan as { update: Record<string, unknown> }).update,
        ).eq("id", agentId);
        if (error) throw new Error(error.message);
        return { updated: agentId };
      },
    }, { confirm_token: typeof args.confirm_token === "string" ? args.confirm_token : undefined });

    return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
  },
};

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

// ── copilot.set_sections — edit the 5 UI prompt sections + faithful recompile ──
const SECTION_KEYS = [
  "personality",
  "objective",
  "flow",
  "products",
  "instructions",
] as const;

const SET_SECTIONS_COLS =
  "id,organization_id,name,conversation_style,can_qualify_lead,can_schedule_meeting,can_move_cards," +
  "can_transfer_human,can_create_lead,can_update_lead,can_send_document,can_transfer_sz_chat,human_pause_enabled";

/** Recompila system_prompt fiel + monta update dos 3 lugares + prompt_hash null. */
export function buildSetSectionsUpdate(
  patch: Partial<ComposePromptSections>,
  currentStyle: Record<string, unknown> | null,
  docs: Parameters<typeof agentRowToComposeInput>[1],
  agentRow: Parameters<typeof agentRowToComposeInput>[0],
): Record<string, unknown> {
  const cs = (currentStyle ?? {}) as { promptSections?: Partial<ComposePromptSections> };
  const merged = mergeSections(
    { ...DEFAULT_PROMPT_SECTIONS, ...(cs.promptSections ?? {}) },
    patch,
  );
  const input = agentRowToComposeInput(
    { ...agentRow, conversation_style: { ...cs, promptSections: merged } },
    docs,
  );
  const systemPrompt = composeSystemPrompt(input);
  return {
    system_prompt: systemPrompt,
    custom_instructions: systemPrompt, // = sectionsToFlatText (paridade Playground)
    conversation_style: { ...(currentStyle ?? {}), promptSections: merged },
    prompt_hash: null,
  };
}

export const copilotSetSectionsTool: ToolDef = {
  name: "copilot.set_sections",
  description:
    "Edit any of a Copilot agent's 5 UI prompt sections (personality|objective|flow|products|" +
    "instructions), recompile system_prompt faithfully (tools+media), write all 3 storage places + " +
    "null prompt_hash so it takes effect at runtime. Partial merge; empty string clears a section. " +
    "Dry-run shows diff + confirm_token; re-call with confirm_token to apply.",
  readonly: false,
  inputSchema: {
    type: "object",
    properties: {
      agent_id: { type: "string", description: "Copilot agent UUID" },
      sections: {
        type: "object",
        description: "Partial: any of personality|objective|flow|products|instructions (string).",
        properties: Object.fromEntries(SECTION_KEYS.map((k) => [k, { type: "string" }])),
        additionalProperties: false,
      },
      confirm_token: { type: "string" },
    },
    required: ["agent_id", "sections"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const db = ctx.db as SupabaseClient;
    const agentId = String(args.agent_id);
    const raw = (args.sections ?? {}) as Record<string, unknown>;
    const patch: Partial<ComposePromptSections> = {};
    for (const k of SECTION_KEYS) {
      if (typeof raw[k] === "string") (patch as Record<string, string>)[k] = raw[k] as string;
    }
    if (Object.keys(patch).length === 0) {
      return {
        content: [{ type: "text", text: "Provide at least one of: " + SECTION_KEYS.join(", ") }],
        isError: true,
      };
    }

    const res = await runMutation({
      plan: async () => {
        const { data, error } = await db.from("copilot_agents").select(SET_SECTIONS_COLS)
          .eq("id", agentId).maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) throw new Error("No copilot agent found.");
        // The long select string overflows supabase-js's type-level parser (→ GenericStringError);
        // cast to the actual row shape (Parameters trick avoids importing AgentRow directly).
        const agent = data as unknown as
          & Parameters<typeof agentRowToComposeInput>[0]
          & { id: string; name: string; organization_id: string };
        const { data: docsData, error: docsErr } = await db.from("copilot_agent_documents")
          .select("id,file_name,file_type,description,send_when").eq("agent_id", agentId);
        // Fail closed: a swallowed docs error would drop the MÍDIA block from the recompile and
        // persist a degraded system_prompt. Throwing in plan() aborts before any token/write.
        if (docsErr) throw new Error(docsErr.message);
        const docs = (docsData ?? []) as Parameters<typeof agentRowToComposeInput>[1];
        const cur =
          (agent.conversation_style as { promptSections?: Partial<ComposePromptSections> }) ?? {};
        const update = buildSetSectionsUpdate(
          patch,
          agent.conversation_style as Record<string, unknown>,
          docs,
          agent,
        );
        return {
          action: "set_sections",
          agent_id: agentId,
          name: agent.name,
          organization_id: agent.organization_id,
          changed: Object.keys(patch),
          sections_before: { ...DEFAULT_PROMPT_SECTIONS, ...(cur.promptSections ?? {}) },
          sections_after: (update.conversation_style as { promptSections: unknown }).promptSections,
          system_prompt_preview: String(update.system_prompt).slice(0, 1200),
          update,
        };
      },
      audit: (_i, plan, token) =>
        auditMcpAction(db, {
          tool: "copilot.set_sections",
          // Trust the agent's own org (resolved in plan), never an unverified caller arg.
          org_id: String((plan as { organization_id?: unknown }).organization_id ?? ""),
          target_type: "copilot_agent",
          target_id: agentId,
          params: args,
          plan,
          confirm_token: token,
        }),
      apply: async (_i, plan) => {
        const { error } = await db.from("copilot_agents")
          .update((plan as { update: Record<string, unknown> }).update).eq("id", agentId);
        if (error) throw new Error(error.message);
        return { updated: agentId };
      },
    }, { confirm_token: typeof args.confirm_token === "string" ? args.confirm_token : undefined });

    return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
  },
};
