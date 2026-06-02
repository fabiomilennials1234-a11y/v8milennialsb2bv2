/**
 * output-judge — Copilot v2 guardrail (Slice 5, ADR-0002 #7).
 *
 * Pre-send gate: a cheap second model vets the reply for an unauthorized price,
 * a forbidden promise/guarantee, a leaked credential, or off-policy tone BEFORE
 * the reply is sent. This module is the PURE decision: the model call (I/O) is
 * injected by the worker. fail-CLOSED — a failed/absent verdict blocks the send;
 * we never ship a reply we could not verify. Sampling lets the operator trade
 * cost for coverage (conservative default = judge every turn).
 */

export type JudgeCategory =
  | "unauthorized_price"
  | "forbidden_promise"
  | "leaked_credential"
  | "off_policy_tone";

export interface JudgeVerdict {
  violation: boolean;
  category: JudgeCategory | null;
}

export interface OutputJudgeGateInput {
  /** The judge model's verdict, or null if the check could not produce one. */
  verdict: JudgeVerdict | null;
  /** True if the judge call (model / parse) threw. */
  checkErrored: boolean;
}

export interface OutputJudgeGateDecision {
  block: boolean;
  reason: string | null;
}

/** fail-CLOSED gate. A failed/absent verdict blocks; a flagged verdict blocks. */
export function decideOutputJudge(input: OutputJudgeGateInput): OutputJudgeGateDecision {
  if (input.checkErrored || input.verdict == null) {
    return { block: true, reason: "output_judge_check_failed" };
  }
  if (input.verdict.violation) {
    return { block: true, reason: `output_judge:${input.verdict.category ?? "unspecified"}` };
  }
  return { block: false, reason: null };
}

export interface SampleInput {
  /** Injected RNG in [0,1). Defaults to Math.random in the worker. */
  rng: () => number;
  /** Sampling rate in [0,1]. 1 = judge every turn (conservative default). */
  rate: number;
}

/** Deterministic cost-sampling decision (pure given rng). */
export function shouldSampleJudge(input: SampleInput): boolean {
  if (input.rate >= 1) return true;
  if (input.rate <= 0) return false;
  return input.rng() < input.rate;
}

/** The prompt fed to the cheap judge model. Tone/policy come from the agent config. */
export function buildJudgePrompt(reply: string, policyNotes: string | null): string {
  return [
    "Você é um auditor de conformidade comercial. Analise a RESPOSTA do agente.",
    "Marque violação se houver: preço/desconto não autorizado, promessa/garantia",
    "(prazo, resultado), credencial/segredo vazado, ou tom fora da política.",
    policyNotes ? `Política da empresa: ${policyNotes}` : "",
    `RESPOSTA: """${reply}"""`,
    'Responda APENAS JSON: {"violation": boolean, "category": string|null}.',
  ].filter(Boolean).join("\n");
}
