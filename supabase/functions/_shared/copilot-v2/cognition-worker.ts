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
import { decideDegradation } from "./degradation.ts";
import { buildSystemPrompt, type AgentConfig } from "./prompt-builder.ts";
import { BASE_PROMPTS } from "./base-prompts.ts";
import { runTurn, type LlmClient, type LlmUsage, type ToolSchema, type ToolStep } from "./cognition-loop.ts";
import {
  TOOL_SCHEMAS,
  writeTargetOf as registryWriteTargetOf,
  introspectionUpdateOf as registryIntrospectionUpdateOf,
} from "./tool-registry.ts";
import type { Introspection } from "./introspect-guard.ts";
import { buildTurnMessages, type HistoryEntry } from "./turn-history.ts";

export interface ResolvedContext {
  contactStatus: ContactStatus;
  activeArchetypes: Set<Archetype>;
  configByArchetype: Record<Archetype, AgentConfig>;
  capabilitiesByArchetype: Record<Archetype, Record<string, boolean | undefined>>;
  introspection: Introspection | null;
  /**
   * Recent shared-transcript history (oldest→newest), injected before the
   * current message (Slice 12, W2-lite). Populated by the worker's
   * resolveContext from conversations/conversation_messages. ABSENT in
   * eval/sim — which keeps those turns byte-identical to the legacy
   * single-message turn, so the W13/W12 goldens never need re-blessing.
   */
  history?: HistoryEntry[];
  /** The active agent resolved for the routed archetype (null when none). */
  _agentId: string | null;
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
  /** Maps a read tool's result → the introspection it contributes this turn
   *  (defaults to the registry mapping; check_agenda_availability → free slots). */
  introspectionUpdateOf?: (name: string, result: unknown) => Partial<Introspection> | null;
  maxToolCalls?: number;
  /** W10 cost degrade level (0..3). >=1 may override the model to a cheaper one
   *  via decideDegradation. Absent (eval/sim) → 0 → base model, fingerprint intact. */
  degradeLevel?: 0 | 1 | 2 | 3;
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
      /** Total token usage of the turn (W10 cost accounting), when reported. */
      usage?: LlmUsage;
    };

export async function handleQueuedMessage(
  input: HandleQueuedMessageInput,
): Promise<HandleQueuedMessageResult> {
  const archetype = routeArchetype(input.context.contactStatus);

  if (!input.context.activeArchetypes.has(archetype)) {
    return { handled: false, reason: "no_active_archetype", archetype };
  }

  const model = modelForArchetype(archetype);
  // W10: under cost pressure, swap to a cheaper model at the CALL SITE. This
  // never edits modelForArchetype, so the eval fingerprint (W13) is untouched —
  // eval/sim pass no degradeLevel, so effectiveModel === model there.
  const degradation = decideDegradation({ degradeLevel: input.degradeLevel ?? 0, baseModel: model });
  const effectiveModel = degradation.modelOverride ?? model;
  const config = input.context.configByArchetype[archetype];
  const system = buildSystemPrompt(archetype, config, BASE_PROMPTS);
  const llm = input.makeLlm(effectiveModel);

  const result = await runTurn({
    llm,
    system,
    // History injected before the current inbound (Slice 12). Empty history →
    // [{ role:'user', content }], identical to the legacy turn (eval-safe).
    messages: buildTurnMessages(input.context.history ?? [], input.message.content),
    toolSchemas: input.toolSchemas ?? TOOL_SCHEMAS,
    capabilities: input.context.capabilitiesByArchetype[archetype] ?? {},
    introspection: input.context.introspection,
    executeTool: input.executeTool,
    writeTargetOf: input.writeTargetOf ?? registryWriteTargetOf,
    introspectionUpdateOf: input.introspectionUpdateOf ?? registryIntrospectionUpdateOf,
    maxToolCalls: input.maxToolCalls,
  });

  return {
    handled: true,
    archetype,
    // The model ACTUALLY used this turn (post-degradation) — so accounting prices
    // the real call and the trace shows the true model.
    model: effectiveModel,
    reply: result.reply,
    steps: result.steps,
    stoppedReason: result.stoppedReason,
    usage: result.usage,
  };
}
