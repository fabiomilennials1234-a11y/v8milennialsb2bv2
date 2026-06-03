/**
 * dry-run-executor — Copilot v2 simulator/eval executor (Slice 9).
 *
 * Drop-in replacement for the real createToolExecutor, fed to the UNCHANGED
 * cognition spine (runTurn/handleQueuedMessage). It NEVER receives a supabase
 * client, so a mutation is impossible by construction:
 *   - READ tools return a stubbed snapshot (the operator-provided seed lead +
 *     live-or-seed structure), so the LLM has something to reason over;
 *   - WRITE tools are recorded as { would_execute: true } in `writes` and return
 *     that to the loop — zero DB writes, zero provider calls.
 * set_qualification_tier is special-cased: it runs the REAL deterministic
 * mapSignalsToTier (the LLM only emits signals; the rubric decides the tier —
 * ADR #3) so the trace shows the tier, still without persisting.
 */

import { TOOL_REGISTRY } from "./tool-registry.ts";
import { mapSignalsToTier, type Rubric, type Signals, type QualificationTier } from "./rubric-engine.ts";
import type { ContactStatus } from "./contact-status.ts";

export interface SeedSnapshot {
  lead360?: unknown;
  contactStatus?: ContactStatus;
  history?: unknown[];
  stages?: string[];
  fields?: string[];
  knowledge?: unknown[];
  agendaSlots?: string[];
}

export interface WouldExecute {
  tool: string;
  args: Record<string, unknown>;
  tier?: QualificationTier | null;
}

export interface DryRunExecutor {
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Append-only record of every write the agent WOULD have performed. */
  writes: WouldExecute[];
}

const KIND_BY_TOOL: Record<string, "read" | "write"> = Object.fromEntries(
  TOOL_REGISTRY.map((t) => [t.name, t.kind]),
);

export function createDryRunExecutor(opts: { snapshot?: SeedSnapshot; rubric?: Rubric }): DryRunExecutor {
  const snap = opts.snapshot ?? {};
  const writes: WouldExecute[] = [];

  const reads: Record<string, () => unknown> = {
    get_lead_360: () => snap.lead360 ?? {},
    get_contact_status: () => ({ status: snap.contactStatus ?? "NOVO" }),
    get_conversation_history: () => ({ history: snap.history ?? [] }),
    list_pipeline_stages: () => ({ stages: snap.stages ?? [] }),
    list_custom_fields: () => ({ fields: snap.fields ?? [] }),
    search_knowledge: () => ({ hits: snap.knowledge ?? [] }),
    check_agenda_availability: () => ({ slots: snap.agendaSlots ?? [] }),
  };

  const executeTool = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    if (KIND_BY_TOOL[name] === "read") {
      return reads[name] ? reads[name]() : {};
    }

    // set_qualification_tier: deterministic rubric, recorded, never persisted.
    if (name === "set_qualification_tier") {
      if (!opts.rubric) {
        writes.push({ tool: name, args, tier: null });
        return { would_execute: true, applied: false, reason: "no_rubric", tier: null, signals: args.signals ?? {} };
      }
      const tier = mapSignalsToTier((args.signals ?? {}) as Signals, opts.rubric);
      writes.push({ tool: name, args, tier });
      return { would_execute: true, applied: true, tier, signals: args.signals ?? {} };
    }

    // Every other write (and any unknown tool the gate let through): record only.
    writes.push({ tool: name, args });
    return { would_execute: true, tool: name, args };
  };

  return { executeTool, writes };
}
