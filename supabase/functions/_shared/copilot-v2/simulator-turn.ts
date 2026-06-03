/**
 * simulator-turn — Copilot v2 dry-run simulator harness (Slice 9).
 *
 * Drives ONE turn through the UNCHANGED cognition spine (handleQueuedMessage)
 * with an in-memory ResolvedContext built from the wizard's (draft or saved)
 * config, a dry-run executor, and an injected LlmClient. NO FORK of cognition:
 * the real capability-gate + write-after-introspect guards run inside runTurn, so
 * a capability the operator left OFF is blocked BEFORE the dry-run executor ever
 * sees it. Returns the in-memory DryRunTrace + the recorded would-execute writes.
 * Zero DB writes, zero queue.
 */

import { handleQueuedMessage, type ResolvedContext } from "./cognition-worker.ts";
import { modelForArchetype, type Archetype, type ModelId } from "./model-selector.ts";
import type { AgentConfig } from "./prompt-builder.ts";
import type { LlmClient } from "./cognition-loop.ts";
import type { ContactStatus } from "./contact-status.ts";
import type { TierRule } from "./rubric-engine.ts";
import { createDryRunExecutor, type SeedSnapshot, type WouldExecute } from "./dry-run-executor.ts";
import { buildDryRunTrace, type DryRunTrace } from "./dry-run-trace.ts";

const STATUS_FOR_ARCHETYPE: Record<Archetype, ContactStatus> = {
  qualificador: "NOVO",
  vendedor: "QUALIFIED",
  carteira: "CLIENTE_CARTEIRA",
};

const EMPTY_CONFIG: AgentConfig = {};

export interface SimulatorTurnInput {
  archetype: Archetype;
  /** Prompt-slot config (toAgentConfig output) — the draft or saved config. */
  config: AgentConfig;
  capabilities: Record<string, boolean | undefined>;
  rubricRules?: TierRule[];
  /** Stubbed reads: contactStatus + lead snapshot + live-or-seed structure. */
  seed?: SeedSnapshot;
  message: string;
}

export interface SimulatorTurnDeps {
  /** Builds the LlmClient for the chosen model (real OpenRouter in the edge; Fake in tests). */
  makeLlm: (model: ModelId) => LlmClient;
  maxToolCalls?: number;
}

export interface SimulatorTurnResult {
  trace: DryRunTrace;
  writes: WouldExecute[];
  reply: string | null;
  model: ModelId;
}

export async function runSimulatorTurn(
  input: SimulatorTurnInput,
  deps: SimulatorTurnDeps,
): Promise<SimulatorTurnResult> {
  // Force the contact-status to route to the configured archetype (the wizard
  // configures one agent of a fixed archetype; the operator tests THAT agent).
  const contactStatus = input.seed?.contactStatus ?? STATUS_FOR_ARCHETYPE[input.archetype];

  const context: ResolvedContext = {
    contactStatus,
    activeArchetypes: new Set<Archetype>([input.archetype]),
    configByArchetype: {
      qualificador: EMPTY_CONFIG,
      vendedor: EMPTY_CONFIG,
      carteira: EMPTY_CONFIG,
      [input.archetype]: input.config,
    },
    capabilitiesByArchetype: {
      qualificador: {},
      vendedor: {},
      carteira: {},
      [input.archetype]: input.capabilities,
    },
    // Write-after-introspect state from the seed (live stages/fields in the edge).
    introspection: {
      stages: input.seed?.stages ?? [],
      fields: input.seed?.fields ?? [],
      slots: input.seed?.agendaSlots ?? [],
    },
    _agentId: "simulator",
  };

  const dry = createDryRunExecutor({
    snapshot: { ...input.seed, contactStatus },
    rubric: input.rubricRules ? { rules: input.rubricRules } : undefined,
  });

  const result = await handleQueuedMessage(
    {
      message: { content: input.message, canonicalPhone: "+550000000000" },
      context,
      makeLlm: deps.makeLlm,
      executeTool: dry.executeTool,
      maxToolCalls: deps.maxToolCalls,
    },
  );

  // activeArchetypes always contains the routed archetype → handled is always true.
  const model = result.handled ? result.model : modelForArchetype(input.archetype);
  const trace = buildDryRunTrace({
    archetype: input.archetype,
    model,
    steps: result.handled ? result.steps : [],
    reply: result.handled ? result.reply : null,
    stoppedReason: result.handled ? result.stoppedReason : "text_reply",
  });

  return { trace, writes: dry.writes, reply: trace.result.reply, model };
}
