// @vitest-environment node
import { describe, expect, it, vi, afterEach } from 'vitest';
import { storedUazapiConnectionState } from '../../supabase/functions/_shared/uazapi-connection-state';
import { normalizeUazapiMessageResult } from '../../supabase/functions/_shared/uazapi-message-result';
import { UazapiProvider } from '../../supabase/functions/_shared/whatsapp-providers/uazapi-provider';

afterEach(() => vi.unstubAllGlobals());
describe('UAZAPI real response normalization', () => {
  it('stores hibernation as unavailable and ignores unknown connection states', () => {
    expect(storedUazapiConnectionState('hibernated')).toBe('disconnected');
    expect(storedUazapiConnectionState('new-state')).toBeUndefined();
    expect(storedUazapiConnectionState(null)).toBeUndefined();
  });
  it('maps Pending and millisecond messageTimestamp to queued and seconds', () => {
    expect(normalizeUazapiMessageResult({ id: 'owner:message', messageid: 'message', status: 'Pending', messageTimestamp: 1789152000123 }))
      .toEqual({ message_id: 'owner:message', status: 'queued', timestamp: 1789152000 });
  });
  it.each(['sent', 'Delivered', 'Read', 'Played'])('normalizes %s as sent', status => {
    expect(normalizeUazapiMessageResult({ id: 'message', status, timestamp: 1789152000 }).status).toBe('sent');
  });
  it('does not report unknown provider states as delivered', () => {
    expect(normalizeUazapiMessageResult({ id: 'message', status: 'future-state', timestamp: 1789152000 }).status).toBe('queued');
  });
  it.each([{}, null, { id: 'message' }, { timestamp: 1789152000 }, { id: 'message', timestamp: -1 }])('rejects malformed send response %j', value => {
    expect(() => normalizeUazapiMessageResult(value)).toThrow();
  });
  it('preserves hibernation without exposing instance credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ instance: { status: 'hibernated', token: 'private' }, status: { connected: false, loggedIn: true } }))));
    const provider = new UazapiProvider({ baseUrl: 'https://contract.test', token: 'test', adminToken: '', instanceId: 'test', organizationId: 'org', supabaseAdmin: {} as never });
    const status = await provider.getStatus();
    expect(status).toMatchObject({ connected: false, state: 'hibernated' });
    expect(status).not.toHaveProperty('token');
  });
});
