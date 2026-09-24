import type { WhatsAppWebhookOptions } from '../../supabase/functions/whatsapp-webhook/handler.ts';

const MAX_RESPONSE_BYTES = 64 * 1024;
// Edge business work alone may take 12 seconds. Leave bounded room for Edge
// authentication, tenant lookup and response transfer within the 45s drain.
const FORWARD_TIMEOUT_MS = 20_000;
type HandlerFactory = (options: WhatsAppWebhookOptions) => (request: Request) => Promise<Response>;
type AdmissionContext = Parameters<NonNullable<WhatsAppWebhookOptions['admitEvent']>>[0];

const unavailable = (reason: string) => new Response(JSON.stringify({ error: reason }), {
  status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': '5' },
});

export function loadLegacyForwardEnabled(get: (key: string) => string | undefined): boolean {
  const value = get('INGRESS_FORWARD_LEGACY_EVENTS') ?? 'false';
  if (value !== 'true' && value !== 'false') throw new Error('Invalid configuration: INGRESS_FORWARD_LEGACY_EVENTS');
  return value === 'true';
}

function validatedProjectOrigin(value: string | undefined): string {
  if (!value) throw new Error('Legacy forwarding requires SUPABASE_URL');
  const url = new URL(value);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)
    || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Legacy forwarding requires a Supabase HTTPS project origin');
  }
  return url.origin;
}

async function boundedResponse(response: Response, aborted: Promise<never>): Promise<Uint8Array> {
  const advertised = Number(response.headers.get('content-length'));
  if (Number.isFinite(advertised) && advertised > MAX_RESPONSE_BYTES) throw new Error('forward_response_too_large');
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await Promise.race([reader.read(), aborted]);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('forward_response_too_large');
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally {
    void reader.cancel().catch(() => {});
  }
}

export function createLegacyEventRouter(options: {
  enabled: boolean;
  supabaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}) {
  const origin = options.enabled ? validatedProjectOrigin(options.supabaseUrl) : null;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? FORWARD_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > FORWARD_TIMEOUT_MS) {
    throw new Error('Invalid legacy forward timeout');
  }
  return {
    enabled: options.enabled,
    async forward(event: string, request: Request, bytes: Uint8Array): Promise<Response> {
      if (!options.enabled || (event !== 'messages' && event !== 'connection')) {
        return unavailable('event_not_enabled');
      }
      const path = new URL(request.url).pathname;
      if (!/^\/(?:functions\/v1\/)?whatsapp-webhook\/[^/]+(?:\/[^/]+){0,2}\/?$/.test(path)) {
        return unavailable('invalid_forward_route');
      }
      const suffix = path.replace(/^\/(?:functions\/v1\/)?/, '/');
      const target = new URL(`/functions/v1${suffix}`, origin!);
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
      let onAbort = () => {};
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error('forward_timeout'));
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      });
      let upstream: Response | undefined;
      try {
        upstream = await Promise.race([fetchImpl(target, {
          method: 'POST', body: bytes.slice().buffer as ArrayBuffer,
          redirect: 'manual', credentials: 'omit', cache: 'no-store', signal,
          headers: { 'Content-Type': 'application/json' },
        }), aborted]);
        if (upstream.status < 200 || upstream.status > 599 || (upstream.status >= 300 && upstream.status < 400)) {
          void upstream.body?.cancel().catch(() => {});
          return unavailable('forward_redirect_rejected');
        }
        const body = await boundedResponse(upstream, aborted);
        const headers = new Headers({ 'Cache-Control': 'no-store' });
        const contentType = upstream.headers.get('content-type');
        if (contentType) headers.set('Content-Type', contentType);
        const retryAfter = upstream.headers.get('retry-after');
        if ((upstream.status === 429 || upstream.status === 503) && retryAfter && /^[0-9]{1,5}$/.test(retryAfter)) {
          headers.set('Retry-After', retryAfter);
        }
        return new Response([204, 205].includes(upstream.status) ? null : body.buffer as ArrayBuffer,
          { status: upstream.status, headers });
      } catch {
        void upstream?.body?.cancel().catch(() => {});
        return unavailable('forward_unavailable');
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
    },
  };
}

export function createIngressEventHandler(factory: HandlerFactory, options: {
  allowInstance: NonNullable<WhatsAppWebhookOptions['allowInstance']>;
  admitReceipt: (context: AdmissionContext) => Promise<Response>;
  router: ReturnType<typeof createLegacyEventRouter>;
}): (request: Request) => Promise<Response> {
  return request => {
    // Runtime has already bounded the body to 2 MiB. Clone before the canonical
    // parser consumes it; read bytes only after auth and resolved-instance gate.
    const original = options.router.enabled ? request.clone() : null;
    let forwarded = false;
    const handler = factory({
      allowInstance: options.allowInstance,
      strictUpdateTargets: true,
      admitEvent: async context => {
        if (context.event === 'messages_update') return options.admitReceipt(context);
        if (!original) return unavailable('event_not_enabled');
        forwarded = true;
        const bytes = new Uint8Array(await original.arrayBuffer());
        return options.router.forward(context.event, request, bytes);
      },
    });
    return handler(request).finally(() => {
      if (original && !forwarded) void original.body?.cancel().catch(() => {});
    });
  };
}
