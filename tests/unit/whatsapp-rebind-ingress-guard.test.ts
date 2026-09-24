// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { UazapiProvider } from '../../supabase/functions/_shared/whatsapp-providers/uazapi-provider.ts';

const mocks = vi.hoisted(() => {
  let handler: (request: Request) => Promise<Response>;
  const env: Record<string, string> = {
    SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key',
    CRON_SECRET: 'fixture-cron-secret', UAZAPI_WEBHOOK_SECRET: 'fixture-webhook-secret',
  };
  Object.assign(globalThis, { Deno: {
    env: { get: (key: string) => env[key] },
    serve: (fn: typeof handler) => { handler = fn; },
  } });
  return {
    env, handler: () => handler, createClient: vi.fn(), getProvider: vi.fn(),
    updateWebhook: vi.fn(), getWebhook: vi.fn(), getInstanceStatus: vi.fn(), log: vi.fn(),
  };
});
vi.mock('https://esm.sh/@supabase/supabase-js@2', () => ({ createClient: mocks.createClient }));
vi.mock('../../supabase/functions/_shared/whatsapp-client.ts', () => ({ getWhatsAppProvider: mocks.getProvider }));
vi.mock('../../supabase/functions/_shared/uazapi-client.ts', () => ({
  UazapiClient: class {
    updateWebhook = mocks.updateWebhook;
    getWebhook = mocks.getWebhook;
    getInstanceStatus = mocks.getInstanceStatus;
  },
}));
vi.mock('../../supabase/functions/_shared/error-boundary.ts', () => ({ withErrorBoundary: (_name: string, handler: unknown) => handler }));
vi.mock('../../supabase/functions/_shared/cors.ts', () => ({ getCorsHeaders: () => ({}) }));
vi.mock('../../supabase/functions/_shared/security-headers.ts', () => ({ withSecurityHeaders: (headers: unknown) => headers }));
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ logRuntime: mocks.log }));
import '../../supabase/functions/whatsapp-rebind-webhook/index.ts';

const pilot = '3ea9d185-62bb-4efd-a9b4-b557938ba9e6';
const webhook = 'https://fixture.supabase.co/functions/v1/whatsapp-webhook/fixture-webhook-secret';
const rpc = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  delete mocks.env.UAZAPI_INGRESS_PROTECTED_INSTANCE_IDS;
  const target = { id: pilot, organization_id: 'org-a', instance_name: 'Pilot', provider: 'uazapi', provider_config: {} };
  const db = {
    rpc,
    from: (table: string) => {
      const query = {
        select: () => query, eq: () => query, limit: () => query, in: () => query,
        maybeSingle: async () => ({ data: { uazapi_instance_id: 'provider-id' }, error: null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === 'whatsapp_instances' ? [target] : [], error: null }).then(resolve),
      };
      return query;
    },
  };
  rpc.mockResolvedValue({ data: null, error: null });
  mocks.createClient.mockReturnValue(db);
  mocks.getProvider.mockResolvedValue(new UazapiProvider({
    baseUrl: 'https://provider.invalid', token: 'fixture-token', instanceId: pilot,
    organizationId: 'org-a', supabaseAdmin: db as never,
  }));
  mocks.updateWebhook.mockResolvedValue({});
  mocks.getWebhook.mockResolvedValue({ url: webhook, enabled: true });
  mocks.getInstanceStatus.mockResolvedValue({ connected: true, status: 'connected' });
});

async function rebind(secret = 'fixture-cron-secret') {
  return mocks.handler()(new Request('https://fixture.invalid/rebind', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret },
    body: JSON.stringify({ scope: 'instance_ids', instance_ids: [pilot] }),
  }));
}

it('reports a protected instance as skipped and unverified without any remote operation', async () => {
  mocks.env.UAZAPI_INGRESS_PROTECTED_INSTANCE_IDS = pilot;
  const response = await rebind();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ selected: 1, succeeded: 0, failed: 0, results: [{
    instance_id: pilot, success: false, skipped_reason: 'webhook_route_protected', verified: null,
  }] });
  expect(rpc).not.toHaveBeenCalled();
  expect(mocks.updateWebhook).not.toHaveBeenCalled();
  expect(mocks.getWebhook).not.toHaveBeenCalled();
  expect(mocks.getInstanceStatus).not.toHaveBeenCalled();
});

it('keeps legacy rebind and verified success when protection is unset', async () => {
  const response = await rebind();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ selected: 1, succeeded: 1, failed: 0, results: [{
    instance_id: pilot, success: true, verified: true, status_after: { connected: true },
  }] });
  expect(mocks.updateWebhook).toHaveBeenCalledOnce();
  expect(mocks.updateWebhook).toHaveBeenCalledWith(expect.objectContaining({ url: webhook }), expect.anything());
  expect(mocks.getWebhook).toHaveBeenCalledOnce();
  expect(mocks.getInstanceStatus).toHaveBeenCalledOnce();
});

it('still requires cron authentication before selecting or rebinding instances', async () => {
  expect((await rebind('wrong-secret')).status).toBe(401);
  expect(mocks.createClient).not.toHaveBeenCalled();
  expect(mocks.getProvider).not.toHaveBeenCalled();
  expect(mocks.updateWebhook).not.toHaveBeenCalled();
});
