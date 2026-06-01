/**
 * cognition-worker — Copilot v2 turn wiring (Slice 2/10).
 *
 * Pulls the spine together for one queued message: deterministic routing
 * (contact-status → archetype) → per-archetype model → immutable base prompt
 * filled with the org config → tool-loop with the cumulative gates. The LLM is
 * built via an injected factory (makeLlm(model)) so the model choice is part of
 * the wiring and the whole flow is testable with fakes (no keys, no DB).
 *
 * If the routed archetype is not enabled for the org, the message is deferred
 * (handled:false) — the caller routes it to a human / leaves it to v1.
 */

import { routeArchetype, type ContactStatus } from "./contact-status.ts";
import { modelForArchetype, type Archetype, type ModelId } from "./model-selector.ts";
import { buildSystemPrompt, type AgentConfig } from "./prompt-builder.ts";
import { BASE_PROMPTS } from "./base-prompts.ts";
import { runTurn, type LlmClient, type ToolSchema, type ToolStep } from "./cognition-loop.ts";
import { TOOL_SCHEMAS, writeTargetOf as registryWriteTargetOf } from "./tool-registry.ts";
import type { Introspection } from "./introspect-guard.ts";

export interface ResolvedContext {
  contactStatus: ContactStatus;
  activeArchetypes: Set<Archetype>;
  configByArchetype: Record<Archetype, AgentConfig>;
  capabilitiesByArchetype: Record<Archetype, Record<string, boolean | undefined>>;
  introspection: Introspection | null;
}

export interface HandleQueuedMessageInput {
  message: { content: string; canonicalPhone: string };
  context: ResolvedContext;
  /** Builds an LLM client bound to the chosen model. */
  makeLlm: (model: ModelId) => LlmClient;
  /** Defaults to the canonical TOOL_SCHEMAS from the registry. */
  toolSchemas?: ToolSchema[];
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  writeTargetOf?: (name: string, args: Record<string, unknown>) => string | null;
  maxToolCalls?: number;
}

export type HandleQueuedMessageResult =
  | { handled: false; reason: "no_active_archetype"; archetype: Archetype }
  | {
      handled: true;
      archetype: Archetype;
      model: ModelId;
      reply: string | null;
      steps: ToolStep[];
      stoppedReason: "text_reply" | "budget_exceeded";
    };

export async function handleQueuedMessage(
  input: HandleQueuedMessageInput,
): Promise<HandleQueuedMessageResult> {
  const archetype = routeArchetype(input.context.contactStatus);

  if (!input.context.activeArchetypes.has(archetype)) {
    return { handled: false, reason: "no_active_archetype", archetype };
  }

  const model = modelForArchetype(archetype);
  const config = input.context.configByArchetype[archetype];
  const system = buildSystemPrompt(archetype, config, BASE_PROMPTS);
  const llm = input.makeLlm(model);

  const result = await runTurn({
    llm,
    system,
    messages: [{ role: "user", content: input.message.content }],
    toolSchemas: input.toolSchemas ?? TOOL_SCHEMAS,
    capabilities: input.context.capabilitiesByArchetype[archetype] ?? {},
    introspection: input.context.introspection,
    executeTool: input.executeTool,
    writeTargetOf: input.writeTargetOf ?? registryWriteTargetOf,
    maxToolCalls: input.maxToolCalls,
  });

  return {
    handled: true,
    archetype,
    model,
    reply: result.reply,
    steps: result.steps,
    stoppedReason: result.stoppedReason,
  };
}
