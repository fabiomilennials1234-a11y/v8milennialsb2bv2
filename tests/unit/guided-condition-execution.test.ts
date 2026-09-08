import { describe, expect, it } from 'vitest';
import '../helpers/deno-mock';
import { createClient } from '@supabase/supabase-js';
import { executeWorkflow } from '../../supabase/functions/_shared/workflow-executor';

describe('guided workflow execution', () => {
  it('rejects an unpublished guided draft before reaching an action or selecting a branch', async () => {
    const database = createClient('https://db.example.test', 'test-service-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async () => new Response('[]', { headers: { 'Content-Type': 'application/json' } }) },
    });
    const result = await executeWorkflow({
      supabase: database, executionId: 'execution-1', workflowId: 'workflow-1', organizationId: 'org-1', leadId: 'lead-1',
      loopLimit: 20, context: {},
      definition: {
        nodes: [
          { id: 'trigger-1', type: 'trigger', data: {} },
          { id: 'condition-1', type: 'condition', data: {
            // Valid legacy fields must never cause a new rule to fall back to
            // the legacy runtime when the new publication is missing.
            field: 'name', operator: 'is_empty', value: '',
            guidedCondition: { version: 1, id: 'rule-1', field: 'lead.name', operator: 'is_empty' },
          } },
          { id: 'end-1', type: 'end', data: {} },
        ],
        edges: [
          { id: 'edge-1', source: 'trigger-1', target: 'condition-1' },
          { id: 'edge-2', source: 'condition-1', target: 'end-1', sourceHandle: 'yes' },
          { id: 'edge-3', source: 'condition-1', target: 'end-1', sourceHandle: 'no' },
        ],
      },
    });
    expect(result).toEqual({ success: false, status: 'failed', error: 'guided_publication_required', stepsExecuted: 0 });
  });
});

it('uses the execution snapshot when current workflow rules no longer contain its wait', async () => {
  const updates: Record<string, unknown>[] = [];
  const database = createClient('https://db.example.test', 'test-service-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      if (init?.method === 'PATCH') updates.push(JSON.parse(String(init.body)));
      if (init?.method === 'GET' && url.pathname === '/rest/v1/workflow_executions') {
        expect(url.searchParams.get('id')).toBe('eq.execution-1');
        expect(url.searchParams.get('organization_id')).toBe('eq.org-1');
        expect(url.searchParams.get('workflow_id')).toBe('eq.workflow-1');
        return new Response(JSON.stringify({ guided_version_id: 'version-1' }), { headers: { 'Content-Type': 'application/json' } });
      }
      if (url.pathname === '/rest/v1/workflow_guided_versions') {
        expect(url.searchParams.get('id')).toBe('eq.version-1');
        expect(url.searchParams.get('organization_id')).toBe('eq.org-1');
        expect(url.searchParams.get('workflow_id')).toBe('eq.workflow-1');
        return new Response(JSON.stringify({ definition: {
          nodes: [{ id: 't', type: 'trigger', data: {} }, { id: 'wait', type: 'delay', data: { amount: 2, unit: 'hours' } }, { id: 'done', type: 'end', data: {} }],
          edges: [{ id: 'tw', source: 't', target: 'wait' }, { id: 'we', source: 'wait', target: 'done' }],
        }, settings: { name: 'Original' } }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
    } },
  });
  const before = Date.now();
  const result = await executeWorkflow({ supabase: database, executionId: 'execution-1', workflowId: 'workflow-1',
    organizationId: 'org-1', leadId: 'lead-1', guidedVersionId: 'version-1', loopLimit: 20, context: {},
    definition: { nodes: [{ id: 't', type: 'trigger', data: {} }, { id: 'done', type: 'end', data: {} }], edges: [{ id: 'td', source: 't', target: 'done' }] },
  });
  expect(result.status).toBe('paused');
  const scheduled = updates.find(update => update.next_run_at);
  expect(scheduled?.current_node_id).toBe('done');
  expect(Date.parse(String(scheduled?.next_run_at)) - before).toBeGreaterThanOrEqual(7200000);
  expect(Date.parse(String(scheduled?.next_run_at)) - Date.now()).toBeLessThanOrEqual(7200000);
});

it('fails without using current rules when the pinned version cannot be read', async () => {
  const steps: unknown[] = [];
  const database = createClient('https://db.example.test', 'test-service-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === '/rest/v1/workflow_execution_steps') steps.push(init?.body);
      const body = init?.method === 'GET' && path === '/rest/v1/workflow_executions'
        ? { guided_version_id: 'version-1' } : path === '/rest/v1/workflow_guided_versions' ? null : [];
      return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    } },
  });
  const result = await executeWorkflow({ supabase: database, executionId: 'execution-1', workflowId: 'workflow-1',
    organizationId: 'org-1', leadId: 'lead-1', guidedVersionId: 'version-1', loopLimit: 20, context: {},
    definition: { nodes: [{ id: 't', type: 'trigger', data: {} }, { id: 'done', type: 'end', data: {} }], edges: [{ id: 'td', source: 't', target: 'done' }] },
  });
  expect(result).toEqual({ success: false, status: 'failed', error: 'execution_version_unavailable', stepsExecuted: 0 });
  expect(steps).toEqual([]);
});

it.each(['José', 'Mariana', 'denied'])('evaluates current authorized data and uses explicit edges or stops: %s', async (currentName) => {
  const completedNodes: string[] = [];
  const database = createClient('https://db.example.test', 'test-service-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === '/rest/v1/workflow_execution_steps') completedNodes.push(JSON.parse(String(init?.body)).node_id);
      let body: unknown = [];
      if (init?.method === 'GET' && path === '/rest/v1/workflow_executions') body = { guided_version_id: 'version-1' };
      if (path === '/rest/v1/workflow_guided_versions') body = { settings: {}, definition: {
        nodes: [{ id: 't', type: 'trigger', data: {} }, { id: 'c', type: 'condition', data: {
          guidedCondition: { version: 1, id: 'rule-1', field: 'lead.name', operator: 'equals', value: 'JOSE' },
        } }, { id: 'yes', type: 'end', data: {} }, { id: 'no', type: 'end', data: {} }],
        edges: [{ id: 'tc', source: 't', target: 'c' }, { id: 'cn', source: 'c', target: 'no', sourceHandle: 'no' },
          { id: 'cy', source: 'c', target: 'yes', sourceHandle: 'yes' }],
      } };
      if (path === '/rest/v1/rpc/read_guided_condition_lead') {
        expect(JSON.parse(String(init?.body))).toEqual({ p_workflow_id: 'workflow-1', p_organization_id: 'org-1', p_lead_id: 'lead-1' });
        if (currentName === 'denied') return new Response(JSON.stringify({ code: '42501', message: 'access_denied' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        body = { id: 'lead-1', organization_id: 'org-1', name: currentName };
      }
      return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    } },
  });
  const result = await executeWorkflow({ supabase: database, executionId: 'execution-1', workflowId: 'workflow-1',
    organizationId: 'org-1', leadId: 'lead-1', guidedVersionId: 'version-1', loopLimit: 20, context: {},
    definition: { nodes: [], edges: [] },
  });
  expect(result).toMatchObject(currentName === 'denied' ? { success: false, status: 'failed', error: 'access_denied' } : { success: true, status: 'completed' });
  expect(completedNodes).toEqual(currentName === 'denied' ? ['t', 'c'] : ['t', 'c', currentName === 'José' ? 'yes' : 'no']);
});
