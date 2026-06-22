import { sha256hex, stableStringify } from "./crypto.ts";

/** Mutating tool input: confirm_token echoes the dry-run plan hash to apply. */
export interface ConfirmableInput {
  confirm_token?: string;
}

export interface MutationResult<P, R> {
  dryRun: boolean;
  applied: boolean;
  plan: P;
  confirmToken?: string;
  result?: R;
}

export interface MutationSpec<D, P, R> {
  plan: (input: D) => Promise<P> | P;
  apply: (input: D, plan: P) => Promise<R> | R;
  /** Audit-first: runs BEFORE apply; throwing aborts the mutation (nothing applied). */
  audit?: (input: D, plan: P, confirmToken: string) => Promise<void> | void;
}

export async function runMutation<D, P, R>(
  spec: MutationSpec<D, P, R>,
  input: D & ConfirmableInput,
): Promise<MutationResult<P, R>> {
  const plan = await spec.plan(input);
  const confirmToken = await sha256hex(stableStringify(plan));
  if (!input.confirm_token) {
    return { dryRun: true, applied: false, plan, confirmToken };
  }
  if (input.confirm_token !== confirmToken) {
    throw new Error(
      "confirm_token mismatch — re-run the dry-run and pass the returned confirmToken",
    );
  }
  if (spec.audit) await spec.audit(input, plan, confirmToken); // audit-first
  const result = await spec.apply(input, plan);
  return { dryRun: false, applied: true, plan, result };
}
