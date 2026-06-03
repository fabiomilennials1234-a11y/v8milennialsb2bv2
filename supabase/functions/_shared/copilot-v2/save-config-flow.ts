/**
 * save-config-flow — Copilot v2 wizard save orchestration (Slice 8). 🔒
 *
 * The pure decision flow the copilot-v2-save-config edge endpoint wraps. Order is
 * fail-CLOSED and pre-DB:
 *   1. schema      — strict validate (no free text beyond escape-hatch; an org_id
 *                    smuggled in the payload is an unknown key → rejected);
 *   2. linter      — deterministic prefilter then (if clean) one LLM classify,
 *                    fail-CLOSED — a flagged or unverifiable escape-hatch blocks;
 *   3. activation  — only when activating; a non-operable agent is rejected
 *                    BEFORE any write, so there is never a half-active row;
 *   4. save        — the transactional SECURITY DEFINER RPC, which derives the
 *                    org from the agent row + auth context (never the payload);
 *   5. activate    — is_active flips only after a clean save.
 * All I/O (the linter LLM, the RPCs) is injected so this stays pure + testable.
 */

import type { Archetype } from "./model-selector.ts";
import {
  validateConfig,
  validateRubricRules,
  splitForPersistence,
  type CopilotV2Config,
  type PersistedSlots,
} from "./config-schema.ts";
import type { TierRule } from "./rubric-engine.ts";
import {
  prefilterEscapeHatch,
  decideEscapeHatchLinter,
  type LinterVerdict,
} from "./escape-hatch-linter.ts";
import { decideActivation } from "./activation-gate.ts";

export interface SaveConfigDeps {
  /** Cheap LLM classify of the escape-hatch (gemini-2.5-flash). Throwing → fail-CLOSED. */
  classifyEscapeHatch: (notes: string, policy: string | null) => Promise<LinterVerdict>;
  /** Whether a non-empty rubric row ALREADY exists in the DB for the agent. */
  rubricPresent: boolean;
  /**
   * Transactional upsert RPC. Resolves the org server-side; never takes a payload
   * org. When rubricRules is non-null, the rubric is upserted in the SAME
   * transaction (Qualificador Section 4) — no orphan window.
   */
  saveConfig: (
    agentId: string,
    slots: PersistedSlots,
    escapeHatchNotes: string | null,
    rubricRules: TierRule[] | null,
  ) => Promise<CopilotV2Config>;
  /** Flips copilot_v2_agents.is_active via its own org-scoped RPC. */
  setActive: (agentId: string, active: boolean) => Promise<void>;
}

export interface SaveConfigInput {
  agentId: string;
  archetype: Archetype;
  rawConfig: unknown;
  activate: boolean;
  /** Qualificador Section 4 rubric-form output (TierRule[]); ignored elsewhere. */
  rubricRules?: unknown;
}

export type SaveConfigResult =
  | { status: "invalid"; errors: string[] }
  | { status: "rejected"; reason: string }
  | { status: "not_activatable"; missingHard: string[]; missingSoft: string[] }
  | { status: "ok"; config: CopilotV2Config };

export async function orchestrateSaveConfig(
  input: SaveConfigInput,
  deps: SaveConfigDeps,
): Promise<SaveConfigResult> {
  // 1. schema — strict, pre-DB.
  const validation = validateConfig(input.archetype, input.rawConfig);
  if (!validation.ok || !validation.value) {
    return { status: "invalid", errors: validation.errors };
  }
  const config = validation.value;

  // 1b. rubric (Qualificador Section 4) — structural validation, pre-DB.
  let rubricRules: TierRule[] | null = null;
  if (input.rubricRules !== undefined) {
    if (input.archetype !== "qualificador") {
      return { status: "invalid", errors: ["rubric is only configurable for the qualificador"] };
    }
    const rr = validateRubricRules(input.rubricRules);
    if (!rr.ok) return { status: "invalid", errors: rr.errors };
    rubricRules = rr.value ?? [];
  }

  // 2. escape-hatch linter — pre-DB, fail-CLOSED. Only runs if there is text.
  const notes = config.escapeHatchNotes;
  if (typeof notes === "string" && notes.trim() !== "") {
    const pre = prefilterEscapeHatch(notes);
    if (pre.flagged) {
      return { status: "rejected", reason: `escape_hatch:${pre.category}` };
    }
    let verdict: LinterVerdict | null = null;
    let checkErrored = false;
    try {
      verdict = await deps.classifyEscapeHatch(notes, config.commercialPolicy ?? null);
    } catch {
      checkErrored = true;
    }
    const decision = decideEscapeHatchLinter({ verdict, checkErrored });
    if (decision.block) {
      return { status: "rejected", reason: decision.reason ?? "escape_hatch_check_failed" };
    }
  }

  // 3. activation gate — reject a non-operable agent BEFORE any write. The rubric
  // counts as present if it exists OR is being saved in this same request.
  if (input.activate) {
    const effectiveRubricPresent = (rubricRules != null && rubricRules.length > 0) || deps.rubricPresent;
    const act = decideActivation(input.archetype, config, effectiveRubricPresent);
    if (!act.ok) {
      return { status: "not_activatable", missingHard: act.missingHard, missingSoft: act.missingSoft };
    }
  }

  // 4. transactional save — org resolved server-side inside the RPC; rubric
  // upserted in the same transaction when provided.
  const { slots, escapeHatchNotes } = splitForPersistence(config);
  const persisted = await deps.saveConfig(input.agentId, slots, escapeHatchNotes, rubricRules);

  // 5. flip active only after a clean save.
  if (input.activate) {
    await deps.setActive(input.agentId, true);
  }

  return { status: "ok", config: persisted };
}
