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
