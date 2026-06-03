/**
 * judge-to-eval-case — Copilot v2 (W13). Closes the judge→dataset loop: an
 * output-judge rejection of a turn becomes an eval-case CANDIDATE.
 *
 * CTO decision D2 (manual-curated): the candidate is ALWAYS enabled=false. Only
 * an admin reviewing it and flipping enabled=true admits it to the blocking CI
 * gate — so the sampled, fail-CLOSED judge (which blocks on its own parse errors)
 * can never auto-poison the gate and break unrelated PRs. Keyed by
 * conversation_id (D4: trace_id step-lineage deferred to Slice 10 completion).
 *
 * Pure + total: returns null for a non-violation, never throws. The edge adds the
 * org (from context, never payload) and persists it (service_role).
 */

import type { JudgeVerdict } from "./output-judge.ts";
import type { Archetype } from "./model-selector.ts";

export interface JudgeToEvalInput {
  /** The output-judge verdict for the rejected turn. */
  verdict: JudgeVerdict;
  /** The archetype that produced the rejected reply. */
  archetype: Archetype;
  /** The lead message that triggered the turn — becomes the eval input. */
  inputMessage: string;
  /** Conversation lineage key (MVP; trace_id is forward-compat, see D4). */
  conversationId: string;
}

export interface EvalCaseCandidate {
  archetype: Archetype;
  caseName: string;
  inputMessage: string;
  /** Always false — a candidate is never auto-admitted to the gate (D2). */
  enabled: false;
  /** Curator note: why it was promoted + what to fill before enabling. */
  systemContext: string;
}

/** Maps a judge rejection to a disabled eval-case candidate, or null if no violation. */
export function judgeToEvalCaseCandidate(input: JudgeToEvalInput): EvalCaseCandidate | null {
  if (!input.verdict.violation) return null;
  const category = input.verdict.category ?? "unspecified";
  return {
    archetype: input.archetype,
    caseName: `judge:${category} · ${input.conversationId}`,
    inputMessage: input.inputMessage,
    enabled: false,
    systemContext:
      `Promovido de uma rejeição do output-judge (${category}). ` +
      `Curar o resultado esperado (tier/tool/ação) antes de habilitar — ` +
      `só casos enabled=true entram no gate de CI.`,
  };
}

/** The copilot_v2_eval_cases insert row for a candidate. */
export interface EvalCaseInsertRow {
  organization_id: string;
  archetype: Archetype;
  case_name: string;
  input_message: string;
  enabled: boolean;
  system_context: string;
}

/**
 * Serializes a candidate to a DB row. org ALWAYS from the caller's context, never
 * the candidate/payload (the candidate carries no org). The edge does the
 * service_role insert (RLS has no authenticated write on eval_cases).
 */
export function candidateToEvalCaseRow(
  candidate: EvalCaseCandidate,
  organizationId: string,
): EvalCaseInsertRow {
  return {
    organization_id: organizationId,
    archetype: candidate.archetype,
    case_name: candidate.caseName,
    input_message: candidate.inputMessage,
    enabled: candidate.enabled,
    system_context: candidate.systemContext,
  };
}
