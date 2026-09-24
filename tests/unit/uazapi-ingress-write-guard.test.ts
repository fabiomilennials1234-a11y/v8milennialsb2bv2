import { UazapiProvider } from '../../supabase/functions/_shared/whatsapp-providers/uazapi-provider';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertLegacyWebhookWriteAllowed, UazapiIngressWriteGuardError } from '../../supabase/functions/_shared/uazapi-ingress-write-guard';

const pilot = '3ea9d185-62bb-4efd-a9b4-b557938ba9e6';
const other = 'e46a6cf2-3540-4148-867b-1ff1e494e788';
function configure(value: string | undefined) {
  vi.stubGlobal('Deno', { env: { get: vi.fn((name: string) => name === 'UAZAPI_INGRESS_PROTECTED_INSTANCE_IDS' ? value : undefined) } });
}
afterEach(() => vi.unstubAllGlobals());

describe('legacy webhook write barrier', () => {
  it.each([undefined, '', '  '])('preserves legacy behavior with an empty list %#', value => {
    configure(value);
    expect(() => assertLegacyWebhookWriteAllowed(pilot)).not.toThrow();
    expect(() => assertLegacyWebhookWriteAllowed('legacy-test-id')).not.toThrow();
  });
  it('blocks a listed UUID with a typed 409, independent of remote route state', () => {
    configure(pilot);
    expect(() => assertLegacyWebhookWriteAllowed(pilot)).toThrow(UazapiIngressWriteGuardError);
    try { assertLegacyWebhookWriteAllowed(pilot); } catch (error) {
      expect(error).toMatchObject({ code: 'webhook_route_protected', status: 409, reason: 'protected_instance' });
      expect(String(error)).not.toContain(pilot);
    }
  });
  it('allows another valid UUID and accepts case-insensitive, whitespace-separated configuration', () => {
    configure(` ${pilot.toUpperCase()} `);
    expect(() => assertLegacyWebhookWriteAllowed(other)).not.toThrow();
    expect(() => assertLegacyWebhookWriteAllowed(pilot)).toThrow(UazapiIngressWriteGuardError);
    expect(() => assertLegacyWebhookWriteAllowed(pilot.toUpperCase())).toThrow(UazapiIngressWriteGuardError);
  });
  it('protects every listed instance', () => {
    configure(`${pilot}, ${other}`);
    expect(() => assertLegacyWebhookWriteAllowed(pilot)).toThrow(UazapiIngressWriteGuardError);
    expect(() => assertLegacyWebhookWriteAllowed(other)).toThrow(UazapiIngressWriteGuardError);
  });
  it.each(['not-a-uuid', `${pilot},`, `,${pilot}`, `${pilot},bad`, 'null', '*'])('fails closed for the entire malformed list %#', value => {
    configure(value);
    expect(() => assertLegacyWebhookWriteAllowed(other)).toThrow(UazapiIngressWriteGuardError);
    try { assertLegacyWebhookWriteAllowed(other); } catch (error) {
      expect(error).toMatchObject({ reason: 'invalid_configuration', code: 'webhook_route_guard_invalid', status: 503 });
      expect(String(error)).not.toContain(value);
    }
  });
  it('fails closed for an invalid instance ID when protection is configured', () => {
    configure(pilot);
    expect(() => assertLegacyWebhookWriteAllowed('not-a-uuid')).toThrow(UazapiIngressWriteGuardError);
  });
  it('rechecks protection on each operation', () => {
    configure(undefined);
    expect(() => assertLegacyWebhookWriteAllowed(pilot)).not.toThrow();
    configure(pilot);
    expect(() => assertLegacyWebhookWriteAllowed(pilot)).toThrow(UazapiIngressWriteGuardError);
  });
});


describe('protected creation', () => {
  it('refuses creation before provider init and credential persistence, preserving typed conflict', async () => {
    configure(pilot);
    const fetchMock=vi.fn();
    vi.stubGlobal('fetch',fetchMock);
    const rpc=vi.fn();
    const provider=new UazapiProvider({baseUrl:'https://fixture.invalid',token:'fixture-token',instanceId:pilot,organizationId:'org',supabaseAdmin:{rpc} as never});
    await expect(provider.createInstance({instance_id:pilot,organization_id:'org',instance_name:'Pilot',webhook_url:'https://fixture.invalid/hook',webhook_secret:'fixture-secret'}))
      .rejects.toMatchObject({name:'UazapiIngressWriteGuardError',code:'webhook_route_protected',status:409});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});


describe('protected adapter reconfiguration', () => {
  it('refuses rebind before accessing central policy or provider transport', async () => {
    configure(pilot);
    const fetchMock=vi.fn();
    vi.stubGlobal('fetch',fetchMock);
    const rpc=vi.fn();
    const provider=new UazapiProvider({baseUrl:'https://fixture.invalid',token:'fixture-token',instanceId:pilot,organizationId:'org',supabaseAdmin:{rpc} as never});
    await expect(provider.reconfigureWebhook('https://fixture.invalid/hook')).rejects.toMatchObject({code:'webhook_route_protected',status:409});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
