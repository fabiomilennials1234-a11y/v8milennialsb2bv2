/**
 * eval-runner — Copilot v2 eval-suite (Slice 9). Runs each eval case through the
 * dry-run simulator (the UNCHANGED spine) and checks the deterministic outcome:
 *   - Qualificador → tier via the real rubric, EXACT match;
 *   - Vendedor → first allowed WRITE tool === expected_tool;
 *   - Carteira semantic expected_action → SKIP (deferred to a later wave).
 * Pure + fail-safe: the LLM + agent config are injected; a case error never
 * throws out (status='error'); ZERO DB writes (dry-run executor). The edge
 * wrapper persists results to copilot_v2_eval_runs.
 */

import { runSimulatorTurn } from "./simulator-turn.ts";
import { TOOL_REGISTRY } from "./tool-registry.ts";
import type { Archetype, ModelId } from "./model-selector.ts";
import type { AgentConfig } from "./prompt-builder.ts";
import type { TierRule, QualificationTier } from "./rubric-engine.ts";
import type { LlmClient } from "./cognition-loop.ts";
import type { SeedSnapshot } from "./dry-run-executor.ts";

const WRITE_TOOLS = new Set(TOOL_REGISTRY.filter((t) => t.kind === "write").map((t) => t.name));

export interface EvalCase {
  id: string;
  caseName: string;
  archetype: Archetype;
  inputMessage: string;
  enabled: boolean;
  expectedTier?: QualificationTier;
  expectedTool?: string;
  expectedAction?: string;
}

export interface AgentResolved {
  config: AgentConfig;
  capabilities: Record<string, boolean | undefined>;
  rubricRules?: TierRule[];
}

export interface EvalRunnerDeps {
  /** The resolved agent config to test for an archetype, or null if not active. */
  agentFor: (archetype: Archetype) => AgentResolved | null;
  /** real (cached) OpenRouter client in the edge; FakeLlm in tests. */
  makeLlm: (model: ModelId, evalCase: EvalCase) => LlmClient;
  seedFor?: (evalCase: EvalCase) => SeedSnapshot;
}

export const EVAL_STATUSES = ["pass", "fail", "skip", "error"] as const;
export type EvalStatus = (typeof EVAL_STATUSES)[number];

export interface EvalRunResult {
  caseId: string;
  caseName: string;
  archetype: Archetype;
  status: EvalStatus;
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
  reasoning: string;
}

export async function runEvalSuite(cases: EvalCase[], deps: EvalRunnerDeps): Promise<EvalRunResult[]> {
  const out: EvalRunResult[] = [];

  for (const c of cases) {
    const base = { caseId: c.id, caseName: c.caseName, archetype: c.archetype };

    if (!c.enabled) {
      out.push({ ...base, status: "skip", expected: {}, actual: {}, reasoning: "case disabled" });
      continue;
    }
    const agent = deps.agentFor(c.archetype);
    if (!agent) {
      out.push({ ...base, status: "skip", expected: {}, actual: {}, reasoning: "no active agent for archetype" });
      continue;
    }
    if (c.expectedTier == null && c.expectedTool == null) {
      const reasoning = c.expectedAction != null
        ? "semantic expected_action deferred to a later wave"
        : "no checkable expectation";
      const expected = c.expectedAction != null ? { action: c.expectedAction } : {};
      out.push({ ...base, status: "skip", expected, actual: {}, reasoning });
      continue;
    }

    try {
      const r = await runSimulatorTurn(
        {
          archetype: c.archetype,
          config: agent.config,
          capabilities: agent.capabilities,
          rubricRules: agent.rubricRules,
          seed: deps.seedFor?.(c) ?? {},
          message: c.inputMessage,
        },
        { makeLlm: (m) => deps.makeLlm(m, c) },
      );

      if (c.expectedTier != null) {
        const tier = r.trace.result.tier ?? null;
        const pass = tier === c.expectedTier;
        out.push({
          ...base,
          status: pass ? "pass" : "fail",
          expected: { tier: c.expectedTier },
          actual: { tier },
          reasoning: pass ? `tier ${tier}` : `expected tier ${c.expectedTier}, got ${tier ?? "none"}`,
        });
      } else {
        const firstWrite = r.trace.steps.find(
          (s) => s.step === "tool" && (s.meta as { allowed?: boolean }).allowed === true && WRITE_TOOLS.has((s.meta as { name?: string }).name ?? ""),
        );
        const tool = firstWrite ? (firstWrite.meta as { name?: string }).name ?? null : null;
        const pass = tool === c.expectedTool;
        out.push({
          ...base,
          status: pass ? "pass" : "fail",
          expected: { tool: c.expectedTool },
          actual: { tool },
          reasoning: pass ? `tool ${tool}` : `expected tool ${c.expectedTool}, got ${tool ?? "none"}`,
        });
      }
    } catch (e) {
      out.push({ ...base, status: "error", expected: {}, actual: {}, reasoning: e instanceof Error ? e.message : String(e) });
    }
  }

  return out;
}
