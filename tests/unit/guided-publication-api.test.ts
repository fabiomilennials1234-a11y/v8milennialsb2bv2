import { afterEach, expect, it, vi } from 'vitest';
import { handleGuidedWorkflowPublication } from '../../supabase/functions/_shared/guided-workflow-publication';

afterEach(() => vi.unstubAllGlobals());

it.each(['end', 'configured_audio', 'fixed_delay', 'random_delay', 'grouped'])('publishes only the persisted revision through the service-only finalizer: %s', async (successPath) => {
  const env: Record<string, string> = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon-test', SUPABASE_SERVICE_ROLE_KEY: 'service-test' };
  vi.stubGlobal('Deno', { env: { get: (key: string) => env[key] } });
  const definition = { nodes: [
    { id: 't', type: 'trigger', data: { triggerType: 'lead_created', config: {} } },
    { id: 'c', type: 'condition', data: { guidedCondition: successPath === 'grouped'
      ? { version: 1, id: 'group', kind: 'group', match: 'any', children: [
        { version: 1, id: 'r', field: 'lead.name', operator: 'equals', value: 'José' },
        { version: 1, id: 'empty', field: 'lead.name', operator: 'is_empty' },
      ] }
      : { version: 1, id: 'r', field: 'lead.name', operator: 'equals', value: 'José' } } },
    { id: 'y', type: successPath === 'configured_audio' ? 'action' : successPath.endsWith('_delay') ? 'delay' : 'end',
      data: successPath === 'configured_audio' ? { actionType: 'send_whatsapp_audio', audioUrl: 'https://media.example.test/audio.ogg' }
        : successPath === 'fixed_delay' ? { amount: 2, unit: 'hours' }
        : successPath === 'random_delay' ? { randomized: true, amountMin: 2, amountMax: 5, unit: 'minutes' } : {} },
    { id: 'n', type: 'end', data: {} },
  ], edges: [{ id: 'tc', source: 't', target: 'c' },
    { id: 'cy', source: 'c', target: 'y', sourceHandle: 'yes' }, { id: 'cn', source: 'c', target: 'n', sourceHandle: 'no' }] };
  let finalizations = 0;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === '/rest/v1/rpc/finalize_guided_workflow_publication') {
      finalizations++;
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer service-test');
      expect(JSON.parse(String(init?.body))).toEqual({ p_workflow_id: 'workflow-1', p_organization_id: 'org-1',
        p_actor_id: 'user-1', p_expected_revision: 3, p_definition: definition, p_settings: { name: 'Persisted' }, p_required_fields: ['lead.name'] });
      return new Response(JSON.stringify({ version_id: 'version-1', version_number: 1 }), { headers: { 'Content-Type': 'application/json' } });
    }
    const resources: Record<string, unknown> = {
      '/auth/v1/user': { id: 'user-1', app_metadata: {}, user_metadata: {}, aud: 'authenticated' },
      '/rest/v1/master_users': null,
      '/rest/v1/team_members': { id: 'member-1', user_id: 'user-1', organization_id: 'org-1', role: 'admin' },
      '/rest/v1/rpc/can_administer_guided_workflow': true,
      '/rest/v1/workflow_guided_drafts': { revision: 3, definition, settings: { name: 'Persisted' } },
    };
    if (!(path in resources)) throw new Error(`Unexpected external request ${path}`);
    return new Response(JSON.stringify(resources[path]), { headers: { 'Content-Type': 'application/json' } });
  });
  const response = await handleGuidedWorkflowPublication(new Request('https://edge.test/publish', {
    method: 'POST', headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId: 'org-1', workflowId: 'workflow-1', expectedRevision: 3, actorId: 'attacker', requiredFields: [] }),
  }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'published', version_id: 'version-1', version_number: 1 });
  expect(finalizations).toBe(1);
});

it('refuses to publish an incomplete persisted condition even when the request supplies a valid replacement', async () => {
  const env: Record<string, string> = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon-test', SUPABASE_SERVICE_ROLE_KEY: 'service-test' };
  vi.stubGlobal('Deno', { env: { get: (key: string) => env[key] } });
  const writes: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const resources: Record<string, unknown> = {
      '/auth/v1/user': { id: 'user-1', app_metadata: {}, user_metadata: {}, aud: 'authenticated' },
      '/rest/v1/master_users': null,
      '/rest/v1/team_members': { id: 'member-1', user_id: 'user-1', organization_id: 'org-1', role: 'admin' },
      '/rest/v1/rpc/can_administer_guided_workflow': true,
      '/rest/v1/workflow_guided_drafts': { revision: 3, settings: { name: 'Draft' }, definition: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'lead_created', config: {} } },
          { id: 'condition', type: 'condition', data: { guidedCondition: { version: 1, id: 'rule', field: 'lead.name', operator: 'equals', value: '' } } },
          { id: 'yes', type: 'end', data: {} }, { id: 'no', type: 'end', data: {} },
        ], edges: [
          { id: 'start', source: 'trigger', target: 'condition' },
          { id: 'yes-edge', source: 'condition', target: 'yes', sourceHandle: 'yes' },
          { id: 'no-edge', source: 'condition', target: 'no', sourceHandle: 'no' },
        ],
      } },
    };
    if (init?.method === 'POST' && url.pathname !== '/rest/v1/rpc/can_administer_guided_workflow') writes.push(url.pathname);
    if (!(url.pathname in resources)) throw new Error(`Unexpected request ${url.pathname}`);
    if (url.pathname === '/rest/v1/workflow_guided_drafts') {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer user-token');
    }
    return new Response(JSON.stringify(resources[url.pathname]), { headers: { 'Content-Type': 'application/json' } });
  });
  const response = await handleGuidedWorkflowPublication(new Request('https://edge.test/publish', {
    method: 'POST', headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId: 'org-1', workflowId: 'workflow-1', expectedRevision: 3,
      definition: { nodes: [], edges: [] }, settings: { name: 'Forged replacement' } }),
  }));
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ status: 'error', code: 'invalid_configuration',
    issues: expect.arrayContaining([expect.objectContaining({ nodeId: 'condition', code: 'invalid_condition' })]) });
  expect(writes).toEqual([]);
});

it('reports an invalid persisted name without attempting publication', async () => {
  const env: Record<string, string> = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon-test', SUPABASE_SERVICE_ROLE_KEY: 'service-test' };
  vi.stubGlobal('Deno', { env: { get: (key: string) => env[key] } });
  let attemptedPublication = false;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    const resources: Record<string, unknown> = {
      '/auth/v1/user': { id: 'user-1', app_metadata: {}, user_metadata: {}, aud: 'authenticated' },
      '/rest/v1/master_users': null,
      '/rest/v1/team_members': { id: 'member-1', user_id: 'user-1', organization_id: 'org-1', role: 'admin' },
      '/rest/v1/rpc/can_administer_guided_workflow': true,
      '/rest/v1/workflow_guided_drafts': { revision: 3, settings: { name: '   ' }, definition: {
        nodes: [{ id: 'trigger', type: 'trigger', data: { triggerType: 'lead_created', config: {} } },
          { id: 'end', type: 'end', data: {} }],
        edges: [{ id: 'te', source: 'trigger', target: 'end' }],
      } },
    };
    if (path === '/rest/v1/rpc/finalize_guided_workflow_publication') {
      attemptedPublication = true;
      return new Response(JSON.stringify({ code: '22023', message: 'invalid_configuration' }), { status: 400 });
    }
    if (!(path in resources)) throw new Error(`Unexpected external request ${path}`);
    return new Response(JSON.stringify(resources[path]), { headers: { 'Content-Type': 'application/json' } });
  });
  const response = await handleGuidedWorkflowPublication(new Request('https://edge.test/publish', {
    method: 'POST', headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId: 'org-1', workflowId: 'workflow-1', expectedRevision: 3 }),
  }));
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ code: 'invalid_configuration',
    issues: expect.arrayContaining([expect.objectContaining({ code: 'invalid_name' })]) });
  expect(attemptedPublication).toBe(false);
});

it.each([['mystery', {}, 'unknown_node_type'], ['action', { actionType: 'invented' }, 'unknown_action_type'], ['trigger', { triggerType: 'invented' }, 'unknown_trigger_type']])('rejects unsupported persisted vocabulary: %s', async (type, data, code) => {
  const env: Record<string, string> = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon-test', SUPABASE_SERVICE_ROLE_KEY: 'service-test' };
  vi.stubGlobal('Deno', { env: { get: (key: string) => env[key] } });
  let attemptedPublication = false;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    const resources: Record<string, unknown> = {
      '/auth/v1/user': { id: 'user-1', app_metadata: {}, user_metadata: {}, aud: 'authenticated' },
      '/rest/v1/master_users': null,
      '/rest/v1/team_members': { id: 'member-1', user_id: 'user-1', organization_id: 'org-1', role: 'admin' },
      '/rest/v1/rpc/can_administer_guided_workflow': true,
      '/rest/v1/workflow_guided_drafts': { revision: 3, settings: { name: 'Valid name' }, definition: {
        nodes: [{ id: 'trigger', type: 'trigger', data: { triggerType: 'lead_created', config: {} } },
          { id: 'end', type, data }],
        edges: [{ id: 'te', source: 'trigger', target: 'end' }],
      } },
    };
    if (path === '/rest/v1/rpc/finalize_guided_workflow_publication') {
      attemptedPublication = true;
      return new Response(JSON.stringify({ code: '22023', message: 'invalid_configuration' }), { status: 400 });
    }
    if (!(path in resources)) throw new Error(`Unexpected external request ${path}`);
    return new Response(JSON.stringify(resources[path]), { headers: { 'Content-Type': 'application/json' } });
  });
  const response = await handleGuidedWorkflowPublication(new Request('https://edge.test/publish', {
    method: 'POST', headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId: 'org-1', workflowId: 'workflow-1', expectedRevision: 3 }),
  }));
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ code: 'invalid_configuration',
    issues: expect.arrayContaining([expect.objectContaining({ code, nodeId: 'end' })]) });
  expect(attemptedPublication).toBe(false);
});


it('denies publication before reading a draft when current administration is absent', async () => {
  const env: Record<string, string> = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon-test', SUPABASE_SERVICE_ROLE_KEY: 'service-test' };
  vi.stubGlobal('Deno', { env: { get: (key: string) => env[key] } });
  const attemptedDraftReads: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path === '/rest/v1/workflow_guided_drafts') attemptedDraftReads.push(path);
    const resources: Record<string, unknown> = {
      '/auth/v1/user': { id: 'user-1', app_metadata: {}, user_metadata: {}, aud: 'authenticated' },
      '/rest/v1/master_users': null,
      '/rest/v1/team_members': { id: 'member-1', user_id: 'user-1', organization_id: 'org-1', role: 'member' },
      '/rest/v1/rpc/can_administer_guided_workflow': false,
    };
    if (!(path in resources)) throw new Error(`Unexpected external request ${path}`);
    return new Response(JSON.stringify(resources[path]), { headers: { 'Content-Type': 'application/json' } });
  });
  const response = await handleGuidedWorkflowPublication(new Request('https://edge.test/publish', {
    method: 'POST', headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId: 'org-1', workflowId: 'workflow-1', expectedRevision: 3 }),
  }));
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ status: 'error', code: 'access_denied' });
  expect(attemptedDraftReads).toEqual([]);
});

it('rejects an audio action without its required media URL', async () => {
  const type = 'action';
  const data = { actionType: 'send_whatsapp_audio' };
  const code = 'incomplete_action';
  const env: Record<string, string> = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon-test', SUPABASE_SERVICE_ROLE_KEY: 'service-test' };
  vi.stubGlobal('Deno', { env: { get: (key: string) => env[key] } });
  let attemptedPublication = false;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    const resources: Record<string, unknown> = {
      '/auth/v1/user': { id: 'user-1', app_metadata: {}, user_metadata: {}, aud: 'authenticated' },
      '/rest/v1/master_users': null,
      '/rest/v1/team_members': { id: 'member-1', user_id: 'user-1', organization_id: 'org-1', role: 'admin' },
      '/rest/v1/rpc/can_administer_guided_workflow': true,
      '/rest/v1/workflow_guided_drafts': { revision: 3, settings: { name: 'Valid name' }, definition: {
        nodes: [{ id: 'trigger', type: 'trigger', data: { triggerType: 'lead_created', config: {} } },
          { id: 'end', type, data }],
        edges: [{ id: 'te', source: 'trigger', target: 'end' }],
      } },
    };
    if (path === '/rest/v1/rpc/finalize_guided_workflow_publication') {
      attemptedPublication = true;
      return new Response(JSON.stringify({ code: '22023', message: 'invalid_configuration' }), { status: 400 });
    }
    if (!(path in resources)) throw new Error(`Unexpected external request ${path}`);
    return new Response(JSON.stringify(resources[path]), { headers: { 'Content-Type': 'application/json' } });
  });
  const response = await handleGuidedWorkflowPublication(new Request('https://edge.test/publish', {
    method: 'POST', headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId: 'org-1', workflowId: 'workflow-1', expectedRevision: 3 }),
  }));
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ code: 'invalid_configuration',
    issues: expect.arrayContaining([expect.objectContaining({ code, nodeId: 'end' })]) });
  expect(attemptedPublication).toBe(false);
});

it.each([
  { randomized: 'true', amount: 2, amountMin: -1, amountMax: 2, unit: 'hours' },
  { amount: 0, unit: 'hours' },
  { amount: -1, unit: 'hours' },
  { amount: '2', unit: 'hours' },
  { amount: 2, unit: 'unknown' },
  { randomized: true, amountMin: 5, amountMax: 2, unit: 'minutes' },
  { randomized: true, amountMin: 1, unit: 'minutes' },
])('rejects an invalid persisted delay: %j', async (data) => {
  const type = 'delay';
  const code = 'invalid_delay';
  const env: Record<string, string> = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon-test', SUPABASE_SERVICE_ROLE_KEY: 'service-test' };
  vi.stubGlobal('Deno', { env: { get: (key: string) => env[key] } });
  let attemptedPublication = false;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    const resources: Record<string, unknown> = {
      '/auth/v1/user': { id: 'user-1', app_metadata: {}, user_metadata: {}, aud: 'authenticated' },
      '/rest/v1/master_users': null,
      '/rest/v1/team_members': { id: 'member-1', user_id: 'user-1', organization_id: 'org-1', role: 'admin' },
      '/rest/v1/rpc/can_administer_guided_workflow': true,
      '/rest/v1/workflow_guided_drafts': { revision: 3, settings: { name: 'Valid name' }, definition: {
        nodes: [{ id: 'trigger', type: 'trigger', data: { triggerType: 'lead_created', config: {} } },
          { id: 'end', type, data }],
        edges: [{ id: 'te', source: 'trigger', target: 'end' }],
      } },
    };
    if (path === '/rest/v1/rpc/finalize_guided_workflow_publication') {
      attemptedPublication = true;
      return new Response(JSON.stringify({ code: '22023', message: 'invalid_configuration' }), { status: 400 });
    }
    if (!(path in resources)) throw new Error(`Unexpected external request ${path}`);
    return new Response(JSON.stringify(resources[path]), { headers: { 'Content-Type': 'application/json' } });
  });
  const response = await handleGuidedWorkflowPublication(new Request('https://edge.test/publish', {
    method: 'POST', headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId: 'org-1', workflowId: 'workflow-1', expectedRevision: 3 }),
  }));
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ code: 'invalid_configuration',
    issues: expect.arrayContaining([expect.objectContaining({ code, nodeId: 'end' })]) });
  expect(attemptedPublication).toBe(false);
});
