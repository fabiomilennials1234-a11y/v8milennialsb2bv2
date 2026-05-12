/**
 * Integration tests for claim_workflow_executions consolidated RPC.
 *
 * Validates that after migration 20261001000000_consolidate_workflow_rpcs.sql:
 *   - Single overload exists (no PostgREST ambiguity)
 *   - per_org_cap distributes work fairly across orgs
 *   - waiting_response rows with expired timeout are reclaimed
 *   - waiting_response rows with future timeout are NOT reclaimed
 *   - Concurrent claims do not double-claim the same row (race safety)
 *
 * Requires local Supabase with the new migration applied.
 */

import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { supabase, TEST_ORG_ID, TEST_ORG_B_ID } from './setup';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

const TEST_ORG_C_ID = '00000000-0000-0000-0000-000000000003';
const createdExecIds: string[] = [];
let testWorkflowId: string;

async function ensureWorkflow(orgId: string): Promise<string> {
  const { data } = await supabase
    .from('workflows')
    .insert({
      organization_id: orgId,
      name: '__claim_test_wf__',
      trigger_type: 'lead_created',
      trigger_config: {},
      is_active: true,
      definition: { nodes: [], edges: [] },
    })
    .select('id')
    .single();
  return data!.id as string;
}

async function insertExecution(
  orgId: string,
  workflowId: string,
  status: string,
  nextRunAt: string | null,
): Promise<string> {
  const { data } = await supabase
    .from('workflow_executions')
    .insert({
      workflow_id: workflowId,
      organization_id: orgId,
      lead_id: null,
      status,
      next_run_at: nextRunAt,
      context: {},
    })
    .select('id')
    .single();
  createdExecIds.push(data!.id as string);
  return data!.id as string;
}

describe.skipIf(shouldSkip)('claim_workflow_executions — consolidated RPC', () => {
  beforeAll(async () => {
    testWorkflowId = await ensureWorkflow(TEST_ORG_ID);
  });

  afterEach(async () => {
    if (createdExecIds.length > 0) {
      await supabase.from('workflow_executions').delete().in('id', createdExecIds);
      createdExecIds.length = 0;
    }
  });

  it('single overload exists (no duplication)', async () => {
    const { data, error } = await supabase.rpc('claim_workflow_executions' as never, {
      batch_size: 1,
    } as never);
    // We don't assert on data here — just that the call resolves to ONE function
    // without PostgREST returning a 300 (multiple choices) or PGRST201.
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('per_org_cap distributes claim across multiple orgs', async () => {
    const wfA = await ensureWorkflow(TEST_ORG_ID);
    const wfB = await ensureWorkflow(TEST_ORG_B_ID);
    const wfC = await ensureWorkflow(TEST_ORG_C_ID);

    // 20 jobs in org A, 5 in org B, 5 in org C
    for (let i = 0; i < 20; i++) await insertExecution(TEST_ORG_ID, wfA, 'running', null);
    for (let i = 0; i < 5; i++) await insertExecution(TEST_ORG_B_ID, wfB, 'running', null);
    for (let i = 0; i < 5; i++) await insertExecution(TEST_ORG_C_ID, wfC, 'running', null);

    const { data, error } = await supabase.rpc('claim_workflow_executions' as never, {
      batch_size: 20,
      per_org_cap: 5,
    } as never);
    expect(error).toBeNull();

    const rows = (data ?? []) as Array<{ organization_id: string }>;
    const byOrg = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.organization_id] = (acc[r.organization_id] ?? 0) + 1;
      return acc;
    }, {});

    // No org should exceed cap
    for (const count of Object.values(byOrg)) {
      expect(count).toBeLessThanOrEqual(5);
    }
    // All three orgs should have at least some claimed (fairness)
    expect(Object.keys(byOrg).length).toBe(3);

    // Cleanup workflows
    await supabase.from('workflows').delete().in('id', [wfA, wfB, wfC]);
  });

  it('reclaims waiting_response with expired next_run_at and sets _wait_resolved=timeout', async () => {
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    const execId = await insertExecution(TEST_ORG_ID, testWorkflowId, 'waiting_response', expiredAt);

    const { data } = await supabase.rpc('claim_workflow_executions' as never, {
      batch_size: 50,
    } as never);
    const rows = (data ?? []) as Array<{ id: string; status: string; context: Record<string, unknown> }>;
    const claimed = rows.find((r) => r.id === execId);

    expect(claimed).toBeDefined();
    expect(claimed!.status).toBe('processing');
    expect(claimed!.context).toMatchObject({ _wait_resolved: 'timeout' });
  });

  it('does NOT reclaim waiting_response with future next_run_at', async () => {
    const futureAt = new Date(Date.now() + 3_600_000).toISOString();
    const execId = await insertExecution(TEST_ORG_ID, testWorkflowId, 'waiting_response', futureAt);

    const { data } = await supabase.rpc('claim_workflow_executions' as never, {
      batch_size: 50,
    } as never);
    const rows = (data ?? []) as Array<{ id: string }>;
    const claimed = rows.find((r) => r.id === execId);
    expect(claimed).toBeUndefined();
  });

  it('concurrent claims do not double-claim the same row', async () => {
    // Insert a single eligible row
    const execId = await insertExecution(TEST_ORG_ID, testWorkflowId, 'running', null);

    // Fire two concurrent claims
    const [resA, resB] = await Promise.all([
      supabase.rpc('claim_workflow_executions' as never, { batch_size: 5 } as never),
      supabase.rpc('claim_workflow_executions' as never, { batch_size: 5 } as never),
    ]);

    const rowsA = ((resA.data ?? []) as Array<{ id: string }>);
    const rowsB = ((resB.data ?? []) as Array<{ id: string }>);

    const countInA = rowsA.filter((r) => r.id === execId).length;
    const countInB = rowsB.filter((r) => r.id === execId).length;

    // The row must appear in AT MOST one of the two responses
    expect(countInA + countInB).toBeLessThanOrEqual(1);
  });
});
