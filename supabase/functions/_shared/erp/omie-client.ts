/**
 * OmieClient — rate-limit-aware transport for the Omie ERP JSON-RPC API.
 *
 * Omie exposes a single POST endpoint per service family; the operation is the
 * `call` field in the body. This is NOT REST. See ADR-0020 for the constraints
 * this module encapsulates (fault-in-200 bodies, 429 backoff, 425 hard-block,
 * serialized writes, capped query concurrency).
 */

export const OMIE_API_BASE = "https://app.omie.com.br/api/v1";

export interface OmieCredentials {
  appKey: string;
  appSecret: string;
}

export interface OmieClientOptions {
  fetchImpl?: typeof fetch;
  /** Injectable delay so backoff is instant under test. Default: real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Max retries on HTTP 429 before giving up. Default 4. */
  maxRetries?: number;
  /** Injectable clock (ms) so the 425 block window is deterministic under test. */
  now?: () => number;
  /** How long a method stays hard-blocked after a 425. Default 30 min. */
  blockMs?: number;
  /** Max concurrent queries (reads). Omie caps at 4. Default 4. */
  maxQueryConcurrency?: number;
}

/**
 * Omie signals business errors in an HTTP 200 body carrying `faultstring` /
 * `faultcode`. The status line lies; the body is the truth.
 */
export class OmieFaultError extends Error {
  readonly faultstring: string;
  readonly faultcode?: string;
  constructor(faultstring: string, faultcode?: string) {
    super(faultstring);
    this.name = "OmieFaultError";
    this.faultstring = faultstring;
    this.faultcode = faultcode;
  }
}

interface OmieFaultBody {
  faultstring: unknown;
  faultcode?: unknown;
}

function isOmieFault(data: unknown): data is OmieFaultBody {
  return typeof data === "object" && data !== null && "faultstring" in data;
}

/**
 * Raised when Omie rate-limits: HTTP 429 (transient, retried with backoff) or
 * HTTP 425 (a ~30-min hard block after repeated method errors — never retried).
 */
export class OmieRateLimitError extends Error {
  readonly status: number;
  readonly method: string;
  constructor(status: number, method: string) {
    super(`Omie rate limit (HTTP ${status}) on ${method}`);
    this.name = "OmieRateLimitError";
    this.status = status;
    this.method = method;
  }
}

export class OmieClient {
  private readonly creds: OmieCredentials;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly now: () => number;
  private readonly blockMs: number;
  /** method → epoch-ms until which it is hard-blocked (after a 425). */
  private readonly blockedUntil = new Map<string, number>();
  /** Tail of the write queue — writes chain here so they never overlap. */
  private writeChain: Promise<unknown> = Promise.resolve();
  /** Counting semaphore for queries: free permits + parked waiters. */
  private queryPermits: number;
  private readonly queryWaiters: Array<() => void> = [];

  constructor(creds: OmieCredentials, opts: OmieClientOptions = {}) {
    this.creds = creds;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRetries = opts.maxRetries ?? 4;
    this.now = opts.now ?? (() => Date.now());
    this.blockMs = opts.blockMs ?? 30 * 60 * 1000;
    this.queryPermits = opts.maxQueryConcurrency ?? 4;
  }

  async call<T = unknown>(
    servicePath: string,
    method: string,
    param: Record<string, unknown> = {},
    opts: { isWrite?: boolean } = {},
  ): Promise<T> {
    // Omie forbids write concurrency; serialize every write behind a mutex.
    if (opts.isWrite) {
      return this.runSerialized(() => this.exchange<T>(servicePath, method, param));
    }
    // Queries run concurrently but capped — Omie allows at most 4 at once.
    return this.runWithQuerySlot(() => this.exchange<T>(servicePath, method, param));
  }

  private async runWithQuerySlot<T>(task: () => Promise<T>): Promise<T> {
    if (this.queryPermits > 0) {
      this.queryPermits--;
    } else {
      await new Promise<void>((resolve) => this.queryWaiters.push(resolve));
    }
    try {
      return await task();
    } finally {
      // Hand the permit straight to the next waiter, or return it to the pool.
      const next = this.queryWaiters.shift();
      if (next) next();
      else this.queryPermits++;
    }
  }

  /** Chain a task onto the write queue so writes run strictly one at a time. */
  private runSerialized<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(task, task);
    // The queue advances whether the task resolved or rejected — a failed write
    // must not wedge the mutex.
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async exchange<T>(
    servicePath: string,
    method: string,
    param: Record<string, unknown>,
  ): Promise<T> {
    const url = `${OMIE_API_BASE}/${servicePath}/`;
    const body = JSON.stringify({
      call: method,
      app_key: this.creds.appKey,
      app_secret: this.creds.appSecret,
      param: [param],
    });

    // Refuse a method still inside its 425 hard-block window — never hit the
    // wire, or Omie extends the block.
    const blockedUntil = this.blockedUntil.get(method);
    if (blockedUntil !== undefined) {
      if (this.now() < blockedUntil) throw new OmieRateLimitError(425, method);
      this.blockedUntil.delete(method);
    }

    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

      if (res.status === 425) {
        this.blockedUntil.set(method, this.now() + this.blockMs);
        throw new OmieRateLimitError(425, method);
      }

      if (res.status === 429) {
        if (attempt >= this.maxRetries) throw new OmieRateLimitError(429, method);
        await this.sleep(this.backoff(attempt));
        continue;
      }

      const data = (await res.json()) as unknown;
      if (isOmieFault(data)) {
        throw new OmieFaultError(
          String(data.faultstring),
          data.faultcode != null ? String(data.faultcode) : undefined,
        );
      }
      return data as T;
    }
  }

  private backoff(attempt: number): number {
    return Math.min(500 * 2 ** attempt, 8000);
  }
}
