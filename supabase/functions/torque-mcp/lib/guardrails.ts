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

export interface MutationOpts {
  /** Injectable clock (ms epoch) — defaults to Date.now. */
  now?: () => number;
  /** confirm_token validity window in ms — defaults to 5 minutes. */
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * confirm_token = `${exp}.${hash}` where hash = sha256(stableStringify(plan) + "." + exp).
 * The hash covers BOTH the plan and the expiry, so a tampered expiry fails the hash check
 * (no separate signing secret needed). exp is the ms-epoch deadline minted at dry-run time.
 */
async function hashPlanWithExp(plan: unknown, exp: number): Promise<string> {
  return await sha256hex(stableStringify(plan) + "." + exp);
}

function parseToken(token: string): { exp: number; hash: string } | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const exp = Number(token.slice(0, dot));
  const hash = token.slice(dot + 1);
  if (!Number.isInteger(exp) || hash.length === 0) return null;
  return { exp, hash };
}

export async function runMutation<D, P, R>(
  spec: MutationSpec<D, P, R>,
  input: D & ConfirmableInput,
  opts?: MutationOpts,
): Promise<MutationResult<P, R>> {
  const now = opts?.now ?? (() => Date.now());
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;

  const plan = await spec.plan(input);

  if (!input.confirm_token) {
    const exp = now() + ttlMs;
    const confirmToken = `${exp}.${await hashPlanWithExp(plan, exp)}`;
    return { dryRun: true, applied: false, plan, confirmToken };
  }

  const parsed = parseToken(input.confirm_token);
  if (!parsed) {
    throw new Error(
      "confirm_token malformed — re-run the dry-run and pass the returned confirmToken",
    );
  }
  const expected = await hashPlanWithExp(plan, parsed.exp);
  if (parsed.hash !== expected) {
    throw new Error(
      "confirm_token mismatch — re-run the dry-run and pass the returned confirmToken",
    );
  }
  if (now() > parsed.exp) {
    throw new Error("confirm_token expired — re-run the dry-run (tokens are valid ~5 min)");
  }

  if (spec.audit) await spec.audit(input, plan, input.confirm_token); // audit-first
  const result = await spec.apply(input, plan);
  return { dryRun: false, applied: true, plan, result };
}
