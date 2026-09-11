import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleGuidedConditionTest } from '../../supabase/functions/_shared/guided-condition-test';

afterEach(() => vi.unstubAllGlobals());

describe('personal condition test API', () => {
  it('accepts evaluation only through POST', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } });
    const response = await handleGuidedConditionTest(new Request('https://edge.test/condition'));
    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 405, body: { status: 'error', code: 'method_not_allowed' },
    });
  });
  it('rejects malformed JSON as a correctable request error', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } });
    const response = await handleGuidedConditionTest(new Request('https://edge.test/condition', {
      method: 'POST', headers: { Authorization: 'Bearer user-token' }, body: '{',
    }));
    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 400, body: { status: 'error', code: 'invalid_configuration' },
    });
  });
  it('allows browser preflight without authenticating or evaluating a condition', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } });
    const response = await handleGuidedConditionTest(new Request('https://edge.test/condition', {
      method: 'OPTIONS', headers: { Origin: 'http://localhost:8080' },
    }));
    expect({ status: response.status, origin: response.headers.get('Access-Control-Allow-Origin'), body: await response.text() })
      .toEqual({ status: 204, origin: 'http://localhost:8080', body: '' });
  });
  it('evaluates an authenticated personal test without commercial writes', async () => {
    const env: Record<string, string> = {
      SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon-test', SUPABASE_SERVICE_ROLE_KEY: 'service-test',
    };
    vi.stubGlobal('Deno', { env: { get: (key: string) => env[key] } });
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (init?.method && init.method !== 'GET') throw new Error('Personal tests must be read-only');
      const resources: Record<string, unknown> = {
        '/auth/v1/user': { id: 'user-1', app_metadata: {}, user_metadata: {}, aud: 'authenticated' },
        '/rest/v1/master_users': null,
        '/rest/v1/team_members': { id: 'member-1', user_id: 'user-1', organization_id: 'org-1', role: 'membro' },
        '/rest/v1/leads': { id: 'lead-1', organization_id: 'org-1', name: 'José' },
      };
      if (!(url.pathname in resources)) throw new Error(`Unexpected external resource: ${url.pathname}`);
      // Service credentials may resolve identity, but must never read test data.
      if (url.pathname === '/rest/v1/leads' && new Headers(init?.headers).get('Authorization') !== 'Bearer user-token') {
        return new Response(JSON.stringify({ code: '42501' }), { status: 403 });
      }
      return new Response(JSON.stringify(resources[url.pathname]), { headers: { 'Content-Type': 'application/json' } });
    });
    const response = await handleGuidedConditionTest(new Request('https://edge.test/condition', {
      method: 'POST', headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: 'org-1', leadId: 'lead-1',
        condition: { version: 1, id: 'rule-1', field: 'lead.name', operator: 'equals', value: 'JOSE' } }),
    }));
    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 200, body: { status: 'evaluated', matched: true,
        rules: [{ id: 'rule-1', status: 'evaluated', matched: true, actual: 'José' }] },
    });
  });
  it('forwards only the opaque selected-message locator to the personal reader', async () => {
    const env: Record<string, string> = {
      SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon-test', SUPABASE_SERVICE_ROLE_KEY: 'service-test',
    };
    vi.stubGlobal('Deno', { env: { get: (key: string) => env[key] } });
    const locator = { storage: 'whatsapp_messages', messageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      boxId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', provider: 'uazapi', participantId: '5511999990000' };
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const resources: Record<string, unknown> = {
        '/auth/v1/user': { id: 'user-1', app_metadata: {}, user_metadata: {}, aud: 'authenticated' },
        '/rest/v1/master_users': null,
        '/rest/v1/team_members': { id: 'member-1', user_id: 'user-1', organization_id: 'org-1', role: 'membro' },
        '/rest/v1/leads': { id: 'lead-1', organization_id: 'org-1', name: 'José' },
      };
      if (path === '/rest/v1/rpc/test_guided_condition_trigger_message') {
        expect(JSON.parse(String(init?.body))).toEqual({ p_organization_id: 'org-1', p_lead_id: 'lead-1', p_locator: {
          storage: locator.storage, messageId: locator.messageId, boxId: locator.boxId,
          provider: locator.provider, participantId: locator.participantId,
        } });
        return new Response(JSON.stringify({ message_id: locator.messageId, text: 'Legenda segura', text_source: 'caption',
          text_provider: 'uazapi', text_created_at: '2026-09-07T12:00:00Z',
          provider: locator.provider, box_id: locator.boxId, participant_id: locator.participantId }), { headers: { 'Content-Type': 'application/json' } });
      }
      if (!(path in resources)) throw new Error(`Unexpected external resource: ${path}`);
      return new Response(JSON.stringify(resources[path]), { headers: { 'Content-Type': 'application/json' } });
    });
    const response = await handleGuidedConditionTest(new Request('https://edge.test/condition', {
      method: 'POST', headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: 'org-1', leadId: 'lead-1', messageContext: locator,
        condition: { version: 1, id: 'message', field: 'message.trigger.text', conversation: { kind: 'trigger' }, operator: 'contains', value: 'segura' } }),
    }));
    expect({ status: response.status, body: await response.json() }).toMatchObject({ status: 200,
      body: { status: 'evaluated', matched: true, rules: [{ actual: 'Legenda segura', reference: { textSource: 'caption' } }] } });
  });
  it('refuses anonymous evaluation without revealing a lead or result', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } });
    const response = await handleGuidedConditionTest(new Request('https://edge.test/condition', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId: 'private-lead', condition: {} }),
    }));
    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 401, body: { status: 'error', code: 'access_denied' },
    });
  });
});
