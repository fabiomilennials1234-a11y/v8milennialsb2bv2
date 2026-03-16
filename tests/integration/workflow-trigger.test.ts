/**
 * Integration tests for workflow trigger logic.
 *
 * Requires local Supabase (`supabase start`).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { supabase, TEST_ORG_ID } from './setup';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

const createdIds: string[] = [];

describe.skipIf(shouldSkip)('Workflow Trigger — integration', () => {
  afterAll(async () => {
    for (const id of createdIds) {
      await supabase.from('workflow_executions').delete().eq('id', id);
    }
  });

  it('active workflow can be inserted and queried', async () => {
    const { data: wf, error } = await supabase
      .from('workflows')
      .insert({
        organization_id: TEST_ORG_ID,
        name: 'Test Workflow',
        trigger_type: 'stage_changed',
        trigger_config: { stage_id: 'stage-1' },
        is_active: true,
      })
      .select('id')
      .single();

    expect(error).toBeNull();
    expect(wf).not.toBeNull();

    // Cleanup
    if (wf?.id) {
      await supabase.from('workflows').delete().eq('id', wf.id);
    }
  });

  it('inactive workflow is not returned when filtering active only', async () => {
    const { data: wf } = await supabase
      .from('workflows')
      .insert({
        organization_id: TEST_ORG_ID,
        name: 'Inactive Workflow',
        trigger_type: 'stage_changed',
        trigger_config: {},
        is_active: false,
      })
      .select('id')
      .single();

    const { data: activeWfs } = await supabase
      .from('workflows')
      .select('id')
      .eq('organization_id', TEST_ORG_ID)
      .eq('is_active', true)
      .eq('name', 'Inactive Workflow');

    expect(activeWfs?.length ?? 0).toBe(0);

    // Cleanup
    if (wf?.id) {
      await supabase.from('workflows').delete().eq('id', wf.id);
    }
  });
});
