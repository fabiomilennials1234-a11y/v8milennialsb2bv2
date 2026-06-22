/**
 * Decide whether the cached master session must be (re)minted.
 * Refresh early by `skewSec` so a request never rides an about-to-expire JWT.
 * @param expiresAtSec session expiry as unix seconds (undefined → no session yet)
 * @param nowMs current time in ms
 */
export function sessionNeedsRefresh(
  expiresAtSec: number | undefined,
  nowMs: number,
  skewSec = 60,
): boolean {
  if (!expiresAtSec) return true;
  return nowMs >= (expiresAtSec - skewSec) * 1000;
}

export interface MasterSession {
  expires_at?: number; // unix seconds
}

export interface SignInResult<T> {
  client: T;
  session: MasterSession;
}

export interface ProviderDeps<T> {
  /** Mint a fresh RLS-scoped master client + its session. */
  signIn: () => Promise<SignInResult<T>>;
  now: () => number;
  skewSec?: number;
}

/**
 * Build a getter that returns an RLS-scoped master client, caching the signed-in
 * session within the isolate and re-minting only when it is (about to be) stale.
 * Pure orchestration — the real sign-in is injected (see clients.ts).
 */
export function createCachedMasterClientProvider<T>(deps: ProviderDeps<T>): () => Promise<T> {
  let cached: SignInResult<T> | null = null;
  return async () => {
    if (!cached || sessionNeedsRefresh(cached.session.expires_at, deps.now(), deps.skewSec)) {
      cached = await deps.signIn();
    }
    return cached.client;
  };
}
