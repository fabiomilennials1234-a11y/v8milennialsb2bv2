// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../services/whatsapp-ingress/config.ts';
import { BackgroundTasks, createIngress } from '../../services/whatsapp-ingress/runtime.ts';

const instanceId = '10000000-0000-0000-0000-000000000001';
const validEnv: Record<string, string> = {
  INGRESS_ENABLED: 'true', INGRESS_INSTANCE_IDS: instanceId,
  INGRESS_SINGLE_WORKER_CONFIRMED: 'true',
  SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
  UAZAPI_WEBHOOK_SECRET: 'fixture-secret', INGRESS_ALLOWED_NET: '0.0.0.0:8080,fixture.supabase.co:443',
};
const config = (overrides: Record<string, string> = {}) => loadConfig(key => ({ ...validEnv, ...overrides })[key]);
const request = (path = '/functions/v1/whatsapp-webhook/fixture-secret', body = '{}') => new Request(`https://ingress.test${path}`, { method: 'POST', body });

describe('standalone ingress rollout configuration', () => {
  it('defaults off and rejects enabling without allowlist/secrets/egress', () => {
    expect(loadConfig(() => undefined).enabled).toBe(false);
    for (const key of ['INGRESS_INSTANCE_IDS', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'UAZAPI_WEBHOOK_SECRET', 'INGRESS_ALLOWED_NET']) {
      expect(() => config({ [key]: '' })).toThrow();
    }
    expect(() => config({ INGRESS_INSTANCE_IDS: 'payload-instance-not-a-database-uuid' })).toThrow();
    expect(() => config({ INGRESS_MAX_REQUESTS: '10000' })).toThrow();
    expect(() => config({ SUPABASE_URL: 'http://fixture.test' })).toThrow();
    expect(() => config({ INGRESS_ACCEPTING: 'FALSE' })).toThrow();
  });

  it('drain-only configuration keeps the worker enabled but rejects new admission', async () => {
    const drainConfig = config({ INGRESS_ACCEPTING: 'false' });
    const canonical = vi.fn();
    const ingress = createIngress(drainConfig, canonical, new BackgroundTasks());
    expect(drainConfig.enabled).toBe(true);
    expect((await ingress.handle(new Request('https://ingress.test/health'))).status).toBe(200);
    expect((await ingress.handle(new Request('https://ingress.test/ready'))).status).toBe(503);
    const rejected = await ingress.handle(request());
    expect(rejected.status).toBe(503);
    expect(rejected.headers.get('Retry-After')).toBe('5');
    expect(canonical).not.toHaveBeenCalled();
  });

  it('disabled service is alive but not ready and never invokes canonical handler', async () => {
    const canonical = vi.fn();
    const ingress = createIngress(loadConfig(() => undefined), canonical, new BackgroundTasks());
    expect((await ingress.handle(new Request('https://ingress.test/health'))).status).toBe(200);
    expect((await ingress.handle(new Request('https://ingress.test/ready'))).status).toBe(503);
    expect((await ingress.handle(request())).status).toBe(503);
    expect(canonical).not.toHaveBeenCalled();
  });
});

describe('transport preserves canonical responses and applies admission limits', () => {
  it.each(['/whatsapp-webhook/fixture-secret', '/functions/v1/whatsapp-webhook/fixture-secret/instance/messages'])('forwards original route/body without proxying to Edge: %s', async path => {
    const canonical = vi.fn(async (req: Request) => {
      expect(new URL(req.url).pathname).toBe(path);
      expect(await req.json()).toEqual({ event: 'messages' });
      return new Response(null, { status: 200 });
    });
    const ingress = createIngress(config(), canonical, new BackgroundTasks());
    expect((await ingress.handle(request(path, '{"event":"messages"}'))).status).toBe(200);
    expect(canonical).toHaveBeenCalledTimes(1);
  });

  it.each([404, 413, 429, 500, 503])('never converts canonical HTTP %i into ACK', async status => {
    const ingress = createIngress(config(), () => new Response('{"error":"dlq_unavailable"}', { status }), new BackgroundTasks());
    const result = await ingress.handle(request());
    expect(result.status).toBe(status);
    expect(await result.text()).toContain('dlq_unavailable');
  });

  it('rejects ambiguous routes and oversized bodies even with false content-length', async () => {
    const canonical = vi.fn();
    const ingress = createIngress(config(), canonical, new BackgroundTasks());
    expect((await ingress.handle(request('/prefix/whatsapp-webhook/fixture-secret'))).status).toBe(404);
    const oversized = request(undefined, 'a'.repeat(2 * 1024 * 1024 + 1));
    oversized.headers.set('content-length', '1');
    expect((await ingress.handle(oversized)).status).toBe(413);
    expect(canonical).not.toHaveBeenCalled();
  });

  it('bounds a stalled request body', async () => {
    const canonical = vi.fn();
    const stream = new ReadableStream({ start() {} });
    const req = new Request('https://ingress.test/whatsapp-webhook/fixture-secret', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
    const ingress = createIngress(config({ INGRESS_BODY_TIMEOUT_MS: '10' }), canonical, new BackgroundTasks());
    expect((await ingress.handle(req)).status).toBe(408);
    expect(canonical).not.toHaveBeenCalled();
  });

  it('rejects overflow and drains active requests plus their background work', async () => {
    let finishRequest!: () => void;
    let finishBackground!: () => void;
    const background = new BackgroundTasks();
    const ingress = createIngress(config({ INGRESS_MAX_REQUESTS: '1' }), async () => {
      await new Promise<void>(resolve => { finishRequest = resolve; });
      background.waitUntil(new Promise<void>(resolve => { finishBackground = resolve; }));
      return new Response(null, { status: 200 });
    }, background);
    const active = ingress.handle(request());
    await vi.waitFor(() => expect(finishRequest).toBeTypeOf('function'));
    expect((await ingress.handle(request())).status).toBe(503);
    ingress.stopAccepting();
    let drained = false;
    const draining = ingress.drain().then(() => { drained = true; });
    finishRequest();
    await active;
    expect(drained).toBe(false);
    expect(background.size).toBe(1);
    finishBackground();
    await draining;
    expect(background.size).toBe(0);
    expect((await ingress.handle(request())).status).toBe(503);
  });
});
