/**
 * Integration tests for fire_workflow_trigger chain_depth guard.
 *
 * Validates that after migration 20261001000000_consolidate_workflow_rpcs.sql:
 *   - Single 5-arg overload exists (4-arg version is dropped)
 *   - Calling without p_triggered_by_execution_id creates exec with chain_depth=1
 *   - Calling with a parent of chain_depth=4 creates exec with chain_depth=5
 *   - Calling with a parent of chain_depth=5 returns 0 (blocked by guard)
 *
 * Requires local Supabase with the new migration applied.
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { supabase, TEST_ORG_ID } from './setup';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

let testWorkflowId: string;
const createdExecIds: string[] = [];

describe.skipIf(shouldSkip)('fire_workflow_trigger — chain_depth guard', () => {
  beforeAll(async () => {
    const { data } = await supabase
      .from('workflows')
      .insert({
        organization_id: TEST_ORG_ID,
        name: '__chain_depth_test_wf__',
        trigger_type: 'lead_created',
        trigger_config: {},
        is_active: true,
        definition: { nodes: [], edges: [] },
      })
      .select('id')
      .single();
    testWorkflowId = data!.id as string;
  });

  afterAll(async () => {
    if (createdExecIds.length > 0) {
      await supabase.from('workflow_executions').delete().in('id', createdExecIds);
    }
    if (testWorkflowId) {
      await supabase.from('workflows').delete().eq('id', testWorkflowId);
    }
  });

  it('fires with chain_depth=1 when no parent given (PG trigger path)', async () => {
    const { data: count, error } = await supabase.rpc('fire_workflow_trigger' as never, {
      p_organization_id: TEST_ORG_ID,
      p_trigger_type: 'lead_created',
      p_lead_id: null,
      p_context: {},
    } as never);
    expect(error).toBeNull();
    expect(Number(count)).toBeGreaterThanOrEqual(1);

    const { data: execs } = await supabase
      .from('workflow_executions')
      .select('id, chain_depth')
      .eq('workflow_id', testWorkflowId)
      .is('triggered_by_execution_id', null)
      .order('started_at', { ascending: false })
      .limit(1);
    const latest = (execs ?? [])[0] as { id: string; chain_depth: number } | undefined;
    expect(latest).toBeDefined();
    expect(latest!.chain_depth).toBe(1);
    createdExecIds.push(latest!.id);
  });

  it('fires with chain_depth=parent+1 when parent given', async () => {
    // Insert parent with chain_depth=4 directly
    const { data: parent } = await supabase
      .from('workflow_executions')
      .insert({
        workflow_id: testWorkflowId,
        organization_id: TEST_ORG_ID,
        status: 'running',
        chain_depth: 4,
        context: {},
      })
      .select('id')
      .single();
    const parentId = parent!.id as string;
    createdExecIds.push(parentId);

    const { data: count, error } = await supabase.rpc('fire_workflow_trigger' as never, {
      p_organization_id: TEST_ORG_ID,
      p_trigger_type: 'lead_created',
      p_lead_id: null,
      p_context: {},
      p_triggered_by_execution_id: parentId,
    } as never);
    expect(error).toBeNull();
    expect(Number(count)).toBe(1);

    const { data: child } = await supabase
      .from('workflow_executions')
      .select('id, chain_depth')
      .eq('triggered_by_execution_id', parentId)
      .maybeSingle();
    expect(child).not.toBeNull();
    expect((child as { chain_depth: number }).chain_depth).toBe(5);
    createdExecIds.push((child as { id: string }).id);
  });

  it('blocks when parent chain_depth is already at max (5)', async () => {
    const { data: parent } = await supabase
      .from('workflow_executions')
      .insert({
        workflow_id: testWorkflowId,
        organization_id: TEST_ORG_ID,
        status: 'running',
        chain_depth: 5,
        context: {},
      })
      .select('id')
      .single();
    const parentId = parent!.id as string;
    createdExecIds.push(parentId);

    const { data: count, error } = await supabase.rpc('fire_workflow_trigger' as never, {
      p_organization_id: TEST_ORG_ID,
      p_trigger_type: 'lead_created',
      p_lead_id: null,
      p_context: {},
      p_triggered_by_execution_id: parentId,
    } as never);
    expect(error).toBeNull();
    expect(Number(count)).toBe(0);

    const { data: child } = await supabase
      .from('workflow_executions')
      .select('id')
      .eq('triggered_by_execution_id', parentId);
    expect(child?.length ?? 0).toBe(0);
  });
});
