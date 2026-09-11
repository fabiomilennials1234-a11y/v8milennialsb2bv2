import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it.each([true, false])('uses the claimed publication or fails when unavailable: %s', async (versionAvailable) => {
  let handler: ((req: Request) => Promise<Response>) | undefined;
  const env: Record<string, string> = { SUPABASE_URL: 'https://db.example.test', SUPABASE_SERVICE_ROLE_KEY: 'service-test', CRON_SECRET: 'cron-test' };
  vi.stubGlobal('Deno', { env: { get: (key: string) => env[key] }, serve: (value: typeof handler) => { handler = value; } });
  const steps: string[] = [];
  const execution = { id: 'e1', workflow_id: 'w1', organization_id: 'o1', lead_id: 'l1', guided_version_id: 'v1', context: { tag_id: 'original-tag' } };
  const version = { settings: { name: 'Original' }, definition: {
    nodes: [{ id: 't', type: 'trigger', data: { triggerType: 'tag_added', config: { tag_id: 'original-tag' } } },
      { id: 'c', type: 'condition', data: { guidedCondition: { version: 1, id: 'r', field: 'lead.name', operator: 'equals', value: 'José' } } },
      { id: 'yes', type: 'end', data: {} }, { id: 'no', type: 'end', data: {} }],
    edges: [{ id: 'tc', source: 't', target: 'c' }, { id: 'cy', source: 'c', target: 'yes', sourceHandle: 'yes' }, { id: 'cn', source: 'c', target: 'no', sourceHandle: 'no' }],
  } };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === '/rest/v1/workflow_execution_steps') steps.push(JSON.parse(String(init?.body)).node_id);
    const resources: Record<string, unknown> = {
      '/rest/v1/cron_config': [],
      '/rest/v1/rpc/claim_workflow_executions': [execution],
      '/rest/v1/rpc/org_get_features_and_limits': { features: { automations: true } },
      '/rest/v1/workflows': { is_active: true, name: 'Changed', loop_limit: 100, trigger_type: 'tag_added', trigger_config: { tag_id: 'different-tag' }, definition: { nodes: [], edges: [] } },
      '/rest/v1/workflow_guided_versions': versionAvailable ? version : null,
      '/rest/v1/workflow_executions': init?.method === 'GET' ? { guided_version_id: 'v1' } : [],
      '/rest/v1/rpc/read_guided_condition_lead': { id: 'l1', organization_id: 'o1', name: 'José' },
      '/rest/v1/automation_jobs': { id: 'job1' },
      '/rest/v1/runtime_logs': [],
    };
    if (!(path in resources)) throw new Error(`Unexpected external request ${path}`);
    return new Response(JSON.stringify(resources[path]), { headers: { 'Content-Type': 'application/json' } });
  });
  await import('../../supabase/functions/process-workflow-executions/index');
  expect(handler).toBeTypeOf('function');
  const response = await handler!(new Request('https://edge.example.test/worker', { method: 'POST', headers: { 'x-cron-secret': 'cron-test' }, body: '{}' }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ stats: { completed: versionAvailable ? 1 : 0, failed: versionAvailable ? 0 : 1 } });
  expect(steps).toEqual(versionAvailable ? ['t', 'c', 'yes'] : []);
});
