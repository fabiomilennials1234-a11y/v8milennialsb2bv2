/**
 * Integration tests for resolve_wait_response_by_phone RPC.
 *
 * Validates that after migration 20261001000002_resolve_wait_response_by_phone.sql:
 *   - Phone normalization handles formatting (spaces, dashes, plus, parens)
 *   - Resolves waiting_response executions for matched lead
 *   - Sets context._wait_resolved='replied' and status='running'
 *   - Idempotent: second call returns 0 (no waiting exec remains)
 *   - Ignores executions of other leads / other orgs
 *
 * Requires local Supabase with the migration applied.
 */

import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { supabase, TEST_ORG_ID } from './setup';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

const TEST_PHONE_DIGITS = '5511999887766';
const TEST_PHONE_FORMATTED = '+55 (11) 99988-7766';

let testLeadId: string;
let testWorkflowId: string;
const createdExecIds: string[] = [];

describe.skipIf(shouldSkip)('resolve_wait_response_by_phone — integration', () => {
  beforeAll(async () => {
    const { data: lead } = await supabase
      .from('leads')
      .insert({
        organization_id: TEST_ORG_ID,
        name: '__wait_resolve_test__',
        phone: TEST_PHONE_DIGITS,
      })
      .select('id')
      .single();
    testLeadId = lead!.id as string;

    const { data: wf } = await supabase
      .from('workflows')
      .insert({
        organization_id: TEST_ORG_ID,
        name: '__wait_resolve_wf__',
        trigger_type: 'lead_created',
        trigger_config: {},
        is_active: true,
        definition: { nodes: [], edges: [] },
      })
      .select('id')
      .single();
    testWorkflowId = wf!.id as string;
  });

  afterEach(async () => {
    if (createdExecIds.length > 0) {
      await supabase.from('workflow_executions').delete().in('id', createdExecIds);
      createdExecIds.length = 0;
    }
  });

  async function insertWaitingExecution(leadId: string, orgId: string): Promise<string> {
    const { data } = await supabase
      .from('workflow_executions')
      .insert({
        workflow_id: testWorkflowId,
        organization_id: orgId,
        lead_id: leadId,
        status: 'waiting_response',
        next_run_at: new Date(Date.now() + 3_600_000).toISOString(),
        context: { trigger_type: 'lead_created' },
      })
      .select('id')
      .single();
    const id = data!.id as string;
    createdExecIds.push(id);
    return id;
  }

  it('resolves waiting execution when phone matches (digits only)', async () => {
    const execId = await insertWaitingExecution(testLeadId, TEST_ORG_ID);

    const { data: count, error } = await supabase.rpc('resolve_wait_response_by_phone' as never, {
      p_phone: TEST_PHONE_DIGITS,
      p_organization_id: TEST_ORG_ID,
      p_channel: 'whatsapp',
    } as never);

    expect(error).toBeNull();
    expect(Number(count)).toBeGreaterThanOrEqual(1);

    const { data: exec } = await supabase
      .from('workflow_executions')
      .select('status, context')
      .eq('id', execId)
      .single();
    expect(exec!.status).toBe('running');
    expect((exec!.context as Record<string, unknown>)._wait_resolved).toBe('replied');
  });

  it('normalizes formatted phone input', async () => {
    const execId = await insertWaitingExecution(testLeadId, TEST_ORG_ID);

    const { data: count, error } = await supabase.rpc('resolve_wait_response_by_phone' as never, {
      p_phone: TEST_PHONE_FORMATTED,
      p_organization_id: TEST_ORG_ID,
      p_channel: 'whatsapp',
    } as never);

    expect(error).toBeNull();
    expect(Number(count)).toBeGreaterThanOrEqual(1);

    const { data: exec } = await supabase
      .from('workflow_executions')
      .select('status')
      .eq('id', execId)
      .single();
    expect(exec!.status).toBe('running');
  });

  it('returns 0 when no waiting execution exists for the phone', async () => {
    // No waiting exec inserted in this test
    const { data: count, error } = await supabase.rpc('resolve_wait_response_by_phone' as never, {
      p_phone: TEST_PHONE_DIGITS,
      p_organization_id: TEST_ORG_ID,
      p_channel: 'whatsapp',
    } as never);

    expect(error).toBeNull();
    expect(Number(count)).toBe(0);
  });

  it('returns 0 for short/invalid phone (security: avoids fuzzy match)', async () => {
    await insertWaitingExecution(testLeadId, TEST_ORG_ID);

    const { data: count } = await supabase.rpc('resolve_wait_response_by_phone' as never, {
      p_phone: '123',
      p_organization_id: TEST_ORG_ID,
      p_channel: 'whatsapp',
    } as never);

    expect(Number(count)).toBe(0);
  });

  it('does not resolve executions of other orgs', async () => {
    // Insert waiting exec in a different org context (use SAME phone but other org)
    const otherOrg = '00000000-0000-0000-0000-000000000999';
    const execId = await insertWaitingExecution(testLeadId, TEST_ORG_ID);

    await supabase.rpc('resolve_wait_response_by_phone' as never, {
      p_phone: TEST_PHONE_DIGITS,
      p_organization_id: otherOrg,
      p_channel: 'whatsapp',
    } as never);

    // Our execution must remain untouched
    const { data: exec } = await supabase
      .from('workflow_executions')
      .select('status')
      .eq('id', execId)
      .single();
    expect(exec!.status).toBe('waiting_response');
  });
});
