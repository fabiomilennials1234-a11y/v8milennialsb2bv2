import type { IngressConfig } from './config.ts';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
type Handler = (request: Request) => Response | Promise<Response>;
const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(status === 503 ? { 'Retry-After': '5' } : {}) },
});

export class BackgroundTasks {
  private tasks = new Set<Promise<unknown>>();
  failed = false;
  get size() { return this.tasks.size; }
  waitUntil(task: Promise<unknown>): void {
    // Catch even when the business task already logs its own failure: no
    // unhandled rejection, no payload or secret in process-level logs.
    const tracked = Promise.resolve(task).catch(() => {
      this.failed = true;
      console.error('[whatsapp-ingress] background task failed');
    });
    this.tasks.add(tracked);
    void tracked.then(() => this.tasks.delete(tracked));
  }
  async drain(): Promise<void> {
    // Tasks may enqueue further tasks while completing.
    while (this.tasks.size) await Promise.allSettled([...this.tasks]);
  }
}

async function boundedBody(request: Request, timeoutMs: number): Promise<ArrayBuffer> {
  const reader = request.body?.getReader();
  if (!reader) return new ArrayBuffer(0);
  const chunks: Uint8Array[] = [];
  let length = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('body_timeout')), timeoutMs);
  });
  try {
    while (true) {
      const result = await Promise.race([reader.read(), timeout]);
      if (result.done) break;
      length += result.value.length;
      if (length > MAX_BODY_BYTES) throw new Error('body_too_large');
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes.buffer;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}

export function createIngress(config: IngressConfig, canonical: Handler, background: BackgroundTasks, workerHealthy: () => boolean = () => true) {
  // Rollback can stop new admission while the enabled worker still drains
  // events already acknowledged by Postgres. Disabling the service stops both.
  let accepting = config.accepting;
  const requests = new Set<Promise<Response>>();
  // Worker health is an operational readiness signal. Admission can still
  // commit to the durable inbox while the worker is recovering.
  const canAdmit = () => accepting && config.enabled && config.instanceIds.size > 0
    && requests.size < config.maxRequests && background.size < config.maxBackgroundTasks;
  const ready = () => canAdmit() && workerHealthy();
  const handle = async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/health') return json(200, { alive: true });
    if (request.method === 'GET' && path === '/ready') return json(ready() ? 200 : 503, { ready: ready() });
    if (!/^\/(?:functions\/v1\/)?whatsapp-webhook\/[^/]+(?:\/[^/]+){0,2}\/?$/.test(path)) return json(404, { error: 'not_found' });
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    if (!canAdmit()) return json(503, { error: 'ingress_unavailable' });
    const work = (async () => {
      try {
        const body = await boundedBody(request, config.bodyTimeoutMs);
        const headers = new Headers(request.headers);
        headers.set('content-length', String(body.byteLength));
        return await canonical(new Request(request.url, { method: 'POST', headers, body, signal: request.signal }));
      } catch (error) {
        const reason = error instanceof Error ? error.message : '';
        if (reason === 'body_too_large') return json(413, { error: reason });
        if (reason === 'body_timeout') return json(408, { error: reason });
        console.error('[whatsapp-ingress] request failed');
        return json(503, { error: 'processing_unavailable' });
      }
    })();
    requests.add(work);
    try { return await work; } finally { requests.delete(work); }
  };
  return {
    handle,
    stopAccepting: () => { accepting = false; },
    async drain() {
      accepting = false;
      await Promise.allSettled([...requests]);
      await background.drain();
    },
  };
}
