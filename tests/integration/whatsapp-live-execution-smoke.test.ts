// Offline smoke of the exact generated Deno bundle. Run with:
// deno test --cached-only --no-check --allow-read --allow-env --allow-net=127.0.0.1 tests/integration/whatsapp-live-execution-smoke.test.ts
const runtime = Deno;
const artifact = runtime.env.get('TORQUE_LIVE_EXECUTION_ARTIFACT') ?? '/tmp/torque-live-execution-bridge-20260924-v3';
const indexUrl = new URL(`file://${artifact}/whatsapp-webhook/index.ts`);
const artifactAvailable = await runtime.stat(indexUrl).then(value => value.isFile).catch(() => false);
const enabledId = '10000000-0000-0000-0000-000000000001';
const organizationId = '30000000-0000-0000-0000-000000000003';
const env: Record<string, string> = {
  SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
  UAZAPI_WEBHOOK_SECRET: 'fixture-secret',
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});
const webhook = (data: unknown) => new Request('https://live-smoke.test/whatsapp-webhook/fixture-secret', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
});
const payload = (id: string, status = 'sent') => ({ instance: 'provider-instance', event: 'messages_update', data: { id, status } });
const assert = (condition: unknown, message: string): asserts condition => { if (!condition) throw new Error(message); };
let handler: (request: Request) => Promise<Response>;
let serial = 0;
const calls: Array<{url:string;method:string;body:unknown}> = [];
let begin: () => Response | Promise<Response> = async () => json({ mode: 'inline', ticket_id: enabledId });
let complete: () => Response | Promise<Response> = async () => json(true);
let writeReceipt: () => Response | Promise<Response> = async () => json([]);
const count = (part: string) => calls.filter(call => call.url.includes(part)).length;

async function load() {
  Object.defineProperty(globalThis, 'Deno', { configurable: true, value: {
    ...runtime, env: { ...runtime.env, get: (key: string) => env[key] },
    serve: (fn: typeof handler) => { handler = fn; },
  } });
  const url = new URL(indexUrl); url.searchParams.set('smoke', String(++serial));
  await import(url.href);
  assert(typeof handler === 'function', 'live bundle did not register handler');
}
function reset() {
  calls.length = 0;
  delete env.WHATSAPP_EDGE_EXECUTION_INSTANCE_IDS;
  delete env.WHATSAPP_EDGE_INBOX_ENABLED;
  begin = async () => json({ mode: 'inline', ticket_id: enabledId });
  complete = async () => json(true);
  writeReceipt = async () => json([]);
}
async function backend(input: Request) {
    const url = input.url;
    const method = input.method;
    const raw = await input.text();
    const body = typeof raw === 'string' && raw ? JSON.parse(raw) : null;
    calls.push({ url, method, body });
    if (url.includes('/rpc/check_rate_limit')) return json({ allowed: true, remaining: 100 });
    if (url.includes('/whatsapp_instance_secrets')) return json({ instance_id: enabledId, organization_id: organizationId });
    if (url.includes('/whatsapp_instances')) return json({ id: enabledId, organization_id: organizationId, provider: 'uazapi' });
    if (url.includes('/rpc/begin_whatsapp_edge_execution')) return begin();
    if (url.includes('/rpc/complete_whatsapp_edge_execution')) return complete();
    if (url.includes('/whatsapp_messages')) return method === 'PATCH' ? writeReceipt() : json([]);
    if (url.includes('/runtime_logs')) return json([]);
    throw new Error(`Unexpected backend request: ${url}`);
}

runtime.test({ name: 'generated live bundle: off, inline, strict mutation, queued, late settlement',
  ignore: !artifactAvailable,
  // v119's unrelated timeout helper leaves legacy timers after fast requests.
  sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const originalTimer = globalThis.setTimeout;
  const server = runtime.serve({ hostname: '127.0.0.1', port: 0 }, backend);
  env.SUPABASE_URL = `http://127.0.0.1:${server.addr.port}`;
  try {
    reset(); await load();
    const off = await handler(webhook(payload('existing-message')));
    assert(off.status === 200, `default-off HTTP status ${off.status} ${await off.text()} ${JSON.stringify(calls)}`);
    assert(count('/rpc/begin_whatsapp_edge_execution') === 0, 'default-off called gate');
    assert(count('/whatsapp_messages') > 0, 'default-off missed canonical effect');

    reset(); env.WHATSAPP_EDGE_EXECUTION_INSTANCE_IDS = enabledId; await load();
    const pure = await handler(webhook(payload('outside-crm')));
    assert(pure.status === 200, `pure missing inline status ${pure.status} ${await pure.text()} ${JSON.stringify(calls)}`);
    assert(count('/rpc/begin_whatsapp_edge_execution') === 1, 'pure inline admission');
    assert(count('/rpc/complete_whatsapp_edge_execution') === 1, 'pure inline settlement');

    reset(); env.WHATSAPP_EDGE_EXECUTION_INSTANCE_IDS = enabledId; await load();
    const pin = { ...payload('outside-crm'), data: { id: 'outside-crm', pinned: true } };
    const pinned = await handler(webhook(pin));
    assert(pinned.status === 500, `nonpure missing target must fail ${pinned.status} ${await pinned.text()} ${JSON.stringify(calls)}`);
    assert(count('/rpc/complete_whatsapp_edge_execution') === 0, 'nonpure failure released ticket');

    reset(); env.WHATSAPP_EDGE_EXECUTION_INSTANCE_IDS = enabledId; await load();
    begin = async () => json({ mode: 'queued', event_id: enabledId });
    const queued = await handler(webhook(payload('existing-message')));
    assert(queued.status === 200, `queued status ${queued.status} ${await queued.text()} ${JSON.stringify(calls)}`);
    assert(count('/rpc/complete_whatsapp_edge_execution') === 0, 'queued settled inline');
    assert(calls.filter(call => call.url.includes('/whatsapp_messages') && call.method === 'PATCH').length === 0, 'queued mutated business row');

    reset(); env.WHATSAPP_EDGE_EXECUTION_INSTANCE_IDS = enabledId; await load();
    let finish!: (value: Response) => void;
    writeReceipt = () => new Promise(resolve => { finish = resolve; });
    // Scale only the 12s HTTP deadline. Business promise remains genuinely pending.
    globalThis.setTimeout = ((callback: TimerHandler, ms?: number, ...args: unknown[]) =>
      originalTimer(callback, ms === 12_000 ? 20 : ms, ...args)) as typeof setTimeout;
    const pending = handler(webhook(payload('existing-message')));
    for (let i = 0; i < 100 && !finish; i++) await new Promise(resolve => originalTimer(resolve, 1));
    assert(typeof finish === 'function', 'receipt write did not start');
    assert((await pending).status === 500, 'deadline did not return HTTP failure');
    assert(count('/rpc/complete_whatsapp_edge_execution') === 0, 'timeout released ticket');
    finish(json([]));
    for (let i = 0; i < 100 && !count('/rpc/complete_whatsapp_edge_execution'); i++) await new Promise(resolve => originalTimer(resolve, 1));
    assert(count('/rpc/complete_whatsapp_edge_execution') === 1, 'late success did not settle ticket');
  } finally {
    globalThis.setTimeout = originalTimer;
    Object.defineProperty(globalThis, 'Deno', { configurable: true, value: runtime });
    await server.shutdown();
  }
}});
