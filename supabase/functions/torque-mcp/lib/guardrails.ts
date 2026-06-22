/** Input shape every mutating tool accepts — `confirm` gates the apply. */
export interface ConfirmableInput {
  confirm?: boolean;
}

export interface MutationResult<P, R> {
  dryRun: boolean;
  applied: boolean;
  plan: P;
  result?: R;
}

export interface MutationSpec<D, P, R> {
  /** Compute what WOULD happen, without applying. Pure-ish; safe to run always. */
  plan: (input: D) => Promise<P> | P;
  /** Apply the planned mutation. Only called when input.confirm === true. */
  apply: (input: D, plan: P) => Promise<R> | R;
  /** Audit hook — called after a successful apply, before returning. */
  audit?: (input: D, plan: P, result: R) => Promise<void> | void;
}

/**
 * Dry-run by default: a mutating tool returns its plan unless `confirm: true`.
 * Nothing is applied (and nothing is audited) without explicit confirmation.
 * `D` (domain input) is inferred from the spec; `confirm` is mixed in here so
 * generic inference stays clean for callers.
 */
export async function runMutation<D, P, R>(
  spec: MutationSpec<D, P, R>,
  input: D & ConfirmableInput,
): Promise<MutationResult<P, R>> {
  const plan = await spec.plan(input);
  if (!input.confirm) {
    return { dryRun: true, applied: false, plan };
  }
  const result = await spec.apply(input, plan);
  if (spec.audit) await spec.audit(input, plan, result);
  return { dryRun: false, applied: true, plan, result };
}
