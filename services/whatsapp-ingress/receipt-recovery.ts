/** Best-effort snapshot reconciliation. This cannot replay lost webhook events. */
export interface ReceiptCandidate {
  organizationId: string;
  instanceId: string;
  messageId: string;
  chatId: string;
  status: string;
}

export interface ReceiptRecoveryPlan {
  organizationId: string;
  instanceId: string;
  messageId: string;
  status: 'delivered' | 'read';
  /** Observation time, never the provider's original receipt time. */
  observedAt: string;
}

export interface ReceiptRecoveryCounts {
  examined: number;
  plannedDelivered: number;
  plannedRead: number;
  alreadyCurrent: number;
  notEligible: number;
  inconclusive: number;
  providerError: number;
  unscanned: number;
}

export type FindMessageById = (id: string, signal: AbortSignal) => Promise<unknown>;
export interface ReceiptRecoveryInput {
  candidates: readonly ReceiptCandidate[];
  findById: FindMessageById;
  signal?: AbortSignal;
  now?: () => Date;
  maxCandidates?: number;
  maxRunMs?: number;
  perRequestMs?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CANDIDATES = 50;
const MAX_RUN_MS = 60_000;
const MAX_REQUEST_MS = 10_000;

function nextStatus(local: string, remote: string): 'delivered' | 'read' | 'already_current' | 'not_eligible' {
  const current = local.toLowerCase();
  const source = remote.toLowerCase();
  if (source === 'delivered') {
    if (['pending', 'sent', 'failed'].includes(current)) return 'delivered';
    if (current === 'delivered' || current === 'read') return 'already_current';
  }
  if (source === 'read') {
    if (['pending', 'sent', 'delivered', 'failed'].includes(current)) return 'read';
    if (current === 'read') return 'already_current';
  }
  return 'not_eligible';
}

function exactSourceMessage(body: unknown, candidate: ReceiptCandidate): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const result = body as Record<string, unknown>;
  if (!Array.isArray(result.messages) || result.messages.length !== 1 || result.returnedMessages !== 1
    || result.limit !== 2 || result.offset !== 0 || result.hasMore !== false) return null;
  const message = result.messages[0];
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  const row = message as Record<string, unknown>;
  if (row.id !== candidate.messageId || row.chatid !== candidate.chatId || row.fromMe !== true
    || typeof row.status !== 'string' || !['delivered', 'read', 'sent', 'pending', 'failed', 'queued', 'canceled'].includes(row.status.toLowerCase())) return null;
  return row.status;
}

/** Build plans only. Caller must re-check tenant, instance and local predecessor atomically before applying. */
export async function planReceiptRecovery(input: ReceiptRecoveryInput): Promise<{
  plans: ReceiptRecoveryPlan[]; counts: ReceiptRecoveryCounts; inconclusiveIndexes: number[];
}> {
  const limit = input.maxCandidates ?? MAX_CANDIDATES;
  const maxRunMs = input.maxRunMs ?? MAX_RUN_MS;
  const perRequestMs = input.perRequestMs ?? MAX_REQUEST_MS;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CANDIDATES || input.candidates.length > limit
    || !Number.isInteger(maxRunMs) || maxRunMs < 1 || maxRunMs > MAX_RUN_MS
    || !Number.isInteger(perRequestMs) || perRequestMs < 1 || perRequestMs > MAX_REQUEST_MS) {
    throw new Error('Receipt recovery bounds exceeded');
  }
  const counts: ReceiptRecoveryCounts = {
    examined: 0, plannedDelivered: 0, plannedRead: 0, alreadyCurrent: 0,
    notEligible: 0, inconclusive: 0, providerError: 0, unscanned: 0,
  };
  const plans: ReceiptRecoveryPlan[] = [];
  const inconclusiveIndexes: number[] = [];
  const seen = new Set<string>();
  const scope = input.candidates[0];
  const started = Date.now();
  for (let index = 0; index < input.candidates.length; index++) {
    if (input.signal?.aborted || Date.now() - started >= maxRunMs) {
      counts.unscanned = input.candidates.length - index;
      break;
    }
    const candidate = input.candidates[index];
    counts.examined++;
    if (!UUID.test(candidate.organizationId) || !UUID.test(candidate.instanceId)
      || candidate.organizationId !== scope.organizationId || candidate.instanceId !== scope.instanceId
      || !candidate.messageId || candidate.messageId.trim() !== candidate.messageId
      || !candidate.chatId || candidate.chatId.trim() !== candidate.chatId
      || typeof candidate.status !== 'string' || !['pending', 'sent', 'delivered', 'read', 'failed'].includes(candidate.status.toLowerCase())
      || seen.has(candidate.messageId)) {
      counts.inconclusive++;
      inconclusiveIndexes.push(index);
      continue;
    }
    seen.add(candidate.messageId);
    const remaining = maxRunMs - (Date.now() - started);
    const controller = new AbortController();
    const abort = () => controller.abort();
    input.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, Math.min(perRequestMs, remaining));
    try {
      // A bounded race also protects against a broken injected client ignoring abort.
      const body = await Promise.race([
        input.findById(candidate.messageId, controller.signal),
        new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Recovery lookup aborted')), { once: true })),
      ]);
      const sourceStatus = exactSourceMessage(body, candidate);
      if (!sourceStatus) { counts.inconclusive++; inconclusiveIndexes.push(index); continue; }
      const status = nextStatus(candidate.status, sourceStatus);
      if (status === 'already_current') { counts.alreadyCurrent++; continue; }
      if (status === 'not_eligible') { counts.notEligible++; continue; }
      plans.push({ organizationId: candidate.organizationId, instanceId: candidate.instanceId,
        messageId: candidate.messageId, status, observedAt: (input.now ?? (() => new Date()))().toISOString() });
      if (status === 'delivered') counts.plannedDelivered++;
      else counts.plannedRead++;
    } catch {
      counts.providerError++;
      counts.unscanned = input.candidates.length - index - 1;
      break;
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', abort);
    }
  }
  return { plans, counts, inconclusiveIndexes };
}

export interface UazapiFindOptions {
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetchImpl?: typeof fetch;
}

/** Exact provider lookup. One POST, no redirects or retries, bounded body. */
export function createUazapiFindById(baseUrl: string, token: string, options: UazapiFindOptions = {}): FindMessageById {
  const url = new URL('/message/find', baseUrl);
  const timeoutMs = options.timeoutMs ?? MAX_REQUEST_MS;
  const maxBytes = options.maxResponseBytes ?? 64 * 1024;
  if (url.protocol !== 'https:' || url.username || url.password || !token
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_REQUEST_MS
    || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 1024 * 1024) throw new Error('Invalid Uazapi lookup configuration');
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (id, signal) => {
    if (signal.aborted) throw new Error('Uazapi lookup aborted');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    try {
      const response = await fetchImpl(url, { method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { token, 'Content-Type': 'application/json' }, body: JSON.stringify({ id, limit: 2, offset: 0 }) });
      if (!response.ok || !response.body) throw new Error('Uazapi lookup failed');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { void reader.cancel().catch(() => {}); throw new Error('Uazapi lookup response too large'); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  };
}
