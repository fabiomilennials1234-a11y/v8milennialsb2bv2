import { beforeEach, expect, it, vi } from 'vitest';
import '../helpers/deno-mock';
vi.mock('../../supabase/functions/_shared/workflow-action-handler.ts', () => ({ executeWorkflowAction: vi.fn() }));
import { executeWorkflowAction } from '../../supabase/functions/_shared/workflow-action-handler';
import { executeWorkflow } from '../../supabase/functions/_shared/workflow-executor';
import { createMockSupabase } from '../helpers/supabase-mock';
const retryAt = '2099-09-19T00:00:00.000Z';
beforeEach(() => vi.resetAllMocks());
const definition = {
  nodes: [{ id: 't', type: 'trigger', data: {} }, { id: 'a', type: 'action', data: { actionType: 'send_whatsapp' } }, { id: 'b', type: 'action', data: { actionType: 'add_tag' } }],
  edges: [{ id: 'ta', source: 't', target: 'a' }, { id: 'ab', source: 'a', target: 'b' }, { id: 'error', source: 'a', target: 'b', sourceHandle: 'error' }],
};
it('pauses at the same action, bypassing error edges and preserving retry/loop budgets; resumes once', async () => {
  const mock = createMockSupabase();
  mock.mockTable('workflow_executions', [{ id: 'exec', organization_id: 'org' }]);
  vi.mocked(executeWorkflowAction).mockResolvedValue({ success: false, error: 'governor_defer:per_number_cap', retryAt });
  const params = { supabase: mock.sb, executionId: 'exec', workflowId: 'wf', organizationId: 'org', leadId: 'lead', definition, loopLimit: 10, context: { _retry_counts: { a: 2 } } };
  expect((await executeWorkflow(params)).status).toBe('paused');
  expect(executeWorkflowAction).toHaveBeenCalledTimes(1);
  const saved = mock.getUpdated('workflow_executions').find(row => row.next_run_at === retryAt)!;
  expect(saved).toMatchObject({ status: 'running', current_node_id: 'a', next_run_at: retryAt, context: { _retry_counts: { a: 2 } }, loop_counters: { a: 0 } });
  expect(mock.getInserted('workflow_execution_steps').some(row => row.status === 'failed')).toBe(false);
  vi.mocked(executeWorkflowAction).mockResolvedValue({ success: true });
  expect((await executeWorkflow({ ...params, currentNodeId: 'a', loopCounters: saved.loop_counters as Record<string, number> })).status).toBe('completed');
});
it('invalid deferral timestamps keep normal failure handling', async () => {
  const mock = createMockSupabase();
  mock.mockTable('workflow_executions', [{ id: 'exec', organization_id: 'org' }]);
  vi.mocked(executeWorkflowAction).mockResolvedValue({ success: false, error: 'transport', retryable: false, retryAt: 'invalid' });
  const result = await executeWorkflow({ supabase: mock.sb, executionId: 'exec', workflowId: 'wf', organizationId: 'org', leadId: 'lead', definition: { ...definition, edges: definition.edges.filter(e => e.id !== 'error') }, loopLimit: 10, context: {} });
  expect(result.status).toBe('failed');
});
it('reports persistence failure instead of claiming a successful pause', async () => {
  const mock = createMockSupabase();
  mock.mockTable('workflow_executions', [{ id: 'exec', organization_id: 'org' }]);
  const from = mock.sb.from.bind(mock.sb);
  vi.spyOn(mock.sb, 'from').mockImplementation((table: string) => {
    const chain = from(table);
    if (table === 'workflow_executions') {
      const update = chain.update.bind(chain);
      chain.update = (value: Record<string, unknown>) => {
        if (value.next_run_at === retryAt) {
          const failed = { eq: () => failed, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: { message: 'write failed' } }).then(resolve) };
          return failed;
        }
        return update(value);
      };
    }
    return chain;
  });
  vi.mocked(executeWorkflowAction).mockResolvedValue({ success: false, retryAt });
  const result = await executeWorkflow({ supabase: mock.sb, executionId: 'exec', workflowId: 'wf', organizationId: 'org', leadId: 'lead', definition, loopLimit: 10, context: {} });
  expect(result).toMatchObject({ success: false, status: 'failed', error: 'governor_defer_persist_failed' });
});
