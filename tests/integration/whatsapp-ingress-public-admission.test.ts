// @vitest-environment node
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { PGlite } from '@electric-sql/pglite';
import { expect, it, vi } from 'vitest';
import { BackgroundTasks, createIngress } from '../../services/whatsapp-ingress/runtime.ts';
import { createIngressEventHandler, createLegacyEventRouter } from '../../services/whatsapp-ingress/event-router.ts';
import { admitReceipt } from '../../services/whatsapp-ingress/inbox.ts';
import { loadConfig } from '../../services/whatsapp-ingress/config.ts';

vi.mock('../../supabase/functions/_shared/logger.ts', () => ({
  logRuntime: vi.fn(async () => {}), redactSecrets: (value: unknown) => value,
}));

const organizationId = '10000000-0000-0000-0000-000000000001';
const instanceId = 'a0000000-0000-0000-0000-000000000001';
const outsideId = 'b0000000-0000-0000-0000-000000000002';
const env: Record<string, string> = {
  SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
  UAZAPI_WEBHOOK_SECRET: 'fixture-secret', INGRESS_ENABLED: 'true', INGRESS_ACCEPTING: 'true',
  INGRESS_INSTANCE_IDS: instanceId, INGRESS_SINGLE_WORKER_CONFIRMED: 'true',
  INGRESS_ALLOWED_NET: '127.0.0.1:8080,fixture.supabase.co:443',
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});
const fixture = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const payload = (sequence: number) => ({ instance: 'provider-instance', event: 'messages_update', data: { sequence } });

// A real local HTTP socket exercises the public route. PostgREST calls are
// translated to disposable PGlite, so a 200 proves the durable SQL committed.
async function listen(ingress: ReturnType<typeof createIngress>): Promise<{ server: Server; origin: string }> {
  const server = createServer(async (incoming, outgoing) => {
    try {
      const request = new Request(`http://127.0.0.1:${(server.address() as { port: number }).port}${incoming.url}`, {
        method: incoming.method, headers: incoming.headers as HeadersInit,
        body: incoming.method === 'POST' ? Readable.toWeb(incoming) as ReadableStream<Uint8Array> : undefined,
        duplex: 'half',
      } as RequestInit);
      const result = await ingress.handle(request);
      outgoing.writeHead(result.status, Object.fromEntries(result.headers));
      outgoing.end(Buffer.from(await result.arrayBuffer()));
    } catch { outgoing.writeHead(500); outgoing.end(); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, origin: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}

it('public ingress authenticates, bounds body, waits for durable admission, and fails closed across a restart', { timeout: 30_000 }, async () => {
  const nativeFetch = globalThis.fetch;
  const directory = await mkdtemp(join(tmpdir(), 'torque-public-admission-'));
  let db = new PGlite(directory);
  let current: { server: Server; origin: string } | undefined;
  let resolvedId = instanceId;
  let failDatabase = false;
  let releaseCommit: (() => void) | undefined;
  let commitReached: (() => void) | undefined;
  const reached = new Promise<void>(resolve => { commitReached = resolve; });
  const calls: string[] = [];
  const upstream = vi.fn(async () => json({ unexpected: true }));
  const count = async () => Number((await db.query('SELECT count(*)::integer AS n FROM public.whatsapp_ingress_events')).rows[0].n);
  try {
    await db.exec(await fixture('tests/fixtures/whatsapp-ingress-inbox-schema.sql'));
    await db.exec(await fixture('supabase/migrations/20271021000029_whatsapp_ingress_durable_inbox.sql'));
    vi.stubGlobal('Deno', { env: { get: (key: string) => env[key], toObject: () => env }, serve: vi.fn() });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push(url);
      if (url.includes('/rpc/check_rate_limit')) return json({ allowed: true, remaining: 100 });
      if (url.includes('/whatsapp_instance_secrets')) return json({ instance_id: resolvedId, organization_id: organizationId });
      if (url.includes('/whatsapp_instances')) return json({ id: resolvedId, organization_id: organizationId, provider: 'uazapi' });
      if (url.includes('/rpc/enqueue_whatsapp_ingress_event')) {
        if (failDatabase) return json({ code: '08006', message: 'database unavailable' }, 503);
        if (commitReached) {
          commitReached(); commitReached = undefined;
          await new Promise<void>(resolve => { releaseCommit = resolve; });
        }
        const args = JSON.parse(String(init?.body));
        const row = await db.query('SELECT public.enqueue_whatsapp_ingress_event($1,$2,$3,$4::jsonb,$5) AS id', [
          args.p_organization_id, args.p_instance_id, args.p_event_name,
          JSON.stringify(args.p_payload), args.p_path_instance_id,
        ]);
        return json(row.rows[0].id);
      }
      throw new Error(`Unexpected database call: ${url}`);
    }));
    const { createWhatsAppWebhookHandler } = await import('../../supabase/functions/whatsapp-webhook/handler.ts');
    const makeIngress = () => createIngress(loadConfig(key => env[key]), createIngressEventHandler(createWhatsAppWebhookHandler, {
      allowInstance: id => id === instanceId,
      admitReceipt,
      router: createLegacyEventRouter({ enabled: true, supabaseUrl: env.SUPABASE_URL, fetchImpl: upstream }),
    }), new BackgroundTasks());
    current = await listen(makeIngress());
    const post = (secret: string, body: string) => nativeFetch(`${current!.origin}/functions/v1/whatsapp-webhook/${secret}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    });

    expect((await nativeFetch(`${current.origin}/ready`)).status).toBe(200);
    expect((await post('wrong-secret', JSON.stringify(payload(1)))).status).toBe(404);
    expect(calls).toHaveLength(0);
    expect((await post('fixture-secret', 'x'.repeat(2 * 1024 * 1024 + 1))).status).toBe(413);
    expect(calls).toHaveLength(0);
    resolvedId = outsideId;
    expect((await post('fixture-secret', JSON.stringify(payload(1)))).status).toBe(503);
    expect(await count()).toBe(0);
    resolvedId = instanceId;

    let acknowledged = false;
    const pending = post('fixture-secret', JSON.stringify(payload(1))).then(result => { acknowledged = true; return result; });
    await reached;
    expect(acknowledged).toBe(false);
    expect(await count()).toBe(0);
    releaseCommit!();
    expect((await pending).status).toBe(200);
    expect(await count()).toBe(1);

    failDatabase = true;
    expect((await post('fixture-secret', JSON.stringify(payload(2)))).status).toBe(503);
    expect(await count()).toBe(1);
    expect(upstream).not.toHaveBeenCalled(); // Receipt failures never fall back to Edge.

    current.server.closeAllConnections();
    await new Promise<void>(resolve => current!.server.close(() => resolve()));
    await db.close();
    db = new PGlite(directory);
    current = await listen(makeIngress());
    expect(await count()).toBe(1);
    failDatabase = false;
    expect((await post('fixture-secret', JSON.stringify(payload(2)))).status).toBe(200);
    expect(await count()).toBe(2);
    expect(upstream).not.toHaveBeenCalled();
  } finally {
    if (current?.server.listening) {
      current.server.closeAllConnections();
      await new Promise<void>(resolve => current!.server.close(() => resolve()));
    }
    await db.close();
    await rm(directory, { recursive: true, force: true });
    vi.unstubAllGlobals();
  }
});
