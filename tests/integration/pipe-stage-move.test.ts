/**
 * Integration tests — Pipeline stage moves (core B2B workflow)
 *
 * Tests the database-level behavior of moving a lead through
 * pipeline_entries stages. Covers the gap left by E2E tests: dnd-kit
 * drag-and-drop cannot be driven by Playwright, so stage moves are
 * verified here at the Supabase/SQL level instead.
 *
 * Requires: local Supabase running with seed applied (`supabase db reset`).
 *
 * Covers:
 *   - novo → abordado → respondeu → agendado (qualification funnel)
 *   - Organization filter: org-A entries do not match org-B queries
 *   - Idempotent update (same status twice is a no-op, no error)
 *   - Cleanup resets lead to original 'novo' state
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { supabase, TEST_ORG_ID, TEST_ORG_B_ID, TEST_LEAD_ALPHA_ID, getSystemPipelineId } from './setup';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

const WA_STAGES = ['novo', 'abordado', 'respondeu', 'agendado'] as const;
let pipelineId: string;
const addedStageIds: string[] = [];

beforeAll(async () => {
  pipelineId = await getSystemPipelineId(TEST_ORG_ID, 'whatsapp');
  const { data: stages, error } = await supabase.from('pipeline_stages')
    .select('stage_key, position').eq('pipeline_id', pipelineId);
  expect(error).toBeNull();
  let position = Math.max(-1, ...(stages ?? []).map(stage => stage.position));
  for (const stageKey of WA_STAGES) {
    if (stages?.some(stage => stage.stage_key === stageKey)) continue;
    const { data, error: insertError } = await supabase.from('pipeline_stages').insert({
      organization_id: TEST_ORG_ID, pipeline_id: pipelineId,
      stage_key: stageKey, name: stageKey, position: ++position, stage_role: 'open',
    }).select('id').single();
    expect(insertError).toBeNull();
    addedStageIds.push(data!.id);
  }
});

afterAll(async () => {
  if (addedStageIds.length) {
    const { error } = await supabase.from('pipeline_stages').delete().in('id', addedStageIds);
    expect(error).toBeNull();
  }
});

async function getWaEntry(leadId: string) {
  return supabase
    .from('pipeline_entries')
    .select('id, status:stage_key, lead_id, organization_id')
    .eq('pipeline_id', pipelineId)
    .eq('lead_id', leadId)
    .eq('organization_id', TEST_ORG_ID)
    .single();
}

async function setWaStatus(leadId: string, status: string) {
  return supabase
    .from('pipeline_entries')
    .update({ stage_key: status })
    .eq('pipeline_id', pipelineId)
    .eq('lead_id', leadId)
    .eq('organization_id', TEST_ORG_ID)
    .select('id, status:stage_key')
    .single();
}

describe.skipIf(shouldSkip)('Pipe WhatsApp — stage moves', () => {

  beforeAll(async () => {
    // Reset to 'novo' before all tests so each run starts clean
    const reset = await setWaStatus(TEST_LEAD_ALPHA_ID, 'novo');
    expect(reset.error).toBeNull();

    const { error } = await getWaEntry(TEST_LEAD_ALPHA_ID);
    expect(error).toBeNull();
  });

  afterAll(async () => {
    // Always reset to 'novo' after suite to not break other tests
    const reset = await setWaStatus(TEST_LEAD_ALPHA_ID, 'novo');
    expect(reset.error).toBeNull();
  });

  it('seeded lead exists in pipeline_entries with status novo', async () => {
    const { data, error } = await getWaEntry(TEST_LEAD_ALPHA_ID);

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data?.status).toBe('novo');
    expect(data?.organization_id).toBe(TEST_ORG_ID);
  });

  it('novo → abordado: status updates correctly', async () => {
    const { data, error } = await setWaStatus(TEST_LEAD_ALPHA_ID, 'abordado');

    expect(error).toBeNull();
    expect(data?.status).toBe('abordado');
  });

  it('abordado → respondeu: status updates correctly', async () => {
    const { data, error } = await setWaStatus(TEST_LEAD_ALPHA_ID, 'respondeu');

    expect(error).toBeNull();
    expect(data?.status).toBe('respondeu');
  });

  it('respondeu → agendado: status updates correctly', async () => {
    const { data, error } = await setWaStatus(TEST_LEAD_ALPHA_ID, 'agendado');

    expect(error).toBeNull();
    expect(data?.status).toBe('agendado');
  });

  it('full qualification sequence: novo → agendado persists each step', async () => {
    // Reset
    const reset = await setWaStatus(TEST_LEAD_ALPHA_ID, 'novo');
    expect(reset.error).toBeNull();

    for (const stage of WA_STAGES) {
      const { data, error } = await setWaStatus(TEST_LEAD_ALPHA_ID, stage);
      expect(error).toBeNull();
      expect(data?.status).toBe(stage);
    }
  });

  it('idempotent update: same status twice has no error', async () => {
    await setWaStatus(TEST_LEAD_ALPHA_ID, 'abordado');

    // Update to same status again
    const { data, error } = await setWaStatus(TEST_LEAD_ALPHA_ID, 'abordado');
    expect(error).toBeNull();
    expect(data?.status).toBe('abordado');
  });

  it('read-back confirms persisted status', async () => {
    await setWaStatus(TEST_LEAD_ALPHA_ID, 'respondeu');

    const { data, error } = await getWaEntry(TEST_LEAD_ALPHA_ID);
    expect(error).toBeNull();
    expect(data?.status).toBe('respondeu');
  });

  it('org-B query cannot see org-A pipeline_entries entry (organization filter)', async () => {
    // Query org-B for the org-A lead — should return nothing
    const { data, error } = await supabase
      .from('pipeline_entries')
      .select('id, status:stage_key')
      .eq('lead_id', TEST_LEAD_ALPHA_ID)
      .eq('organization_id', TEST_ORG_B_ID);

    // With service_role the RLS is bypassed, but the data simply won't
    // exist because the lead belongs to org-A, not org-B.
    // This test verifies the data model isolation, not RLS policy enforcement.
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });
});

describe.skipIf(shouldSkip)('Pipe WhatsApp — lead entry creation', () => {
  const createdLeadIds: string[] = [];

  afterAll(async () => {
    // Cleanup test leads and their pipe entries (cascade delete if configured)
    if (createdLeadIds.length > 0) {
      const entries = await supabase.from('pipeline_entries').delete()
        .eq('organization_id', TEST_ORG_ID).eq('pipeline_id', pipelineId).in('lead_id', createdLeadIds);
      expect(entries.error).toBeNull();
      const leads = await supabase.from('leads').delete().eq('organization_id', TEST_ORG_ID).in('id', createdLeadIds);
      expect(leads.error).toBeNull();
    }
  });

  it('new lead can be added to pipeline_entries in novo stage', async () => {
    // Create a lead
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .insert({
        name: 'Stage Move Test Lead',
        phone: '+5511900001111',
        organization_id: TEST_ORG_ID,
      })
      .select('id')
      .single();

    expect(leadErr).toBeNull();
    expect(lead?.id).toBeTruthy();
    if (lead?.id) createdLeadIds.push(lead.id);

    // Place in pipeline_entries at novo
    const { data: pipe, error: pipeErr } = await supabase
      .from('pipeline_entries')
      .insert({
        lead_id: lead!.id,
        organization_id: TEST_ORG_ID,
        stage_key: 'novo',
        pipeline_id: pipelineId,
      })
      .select('id, status:stage_key, lead_id')
      .single();

    expect(pipeErr).toBeNull();
    expect(pipe?.status).toBe('novo');
    expect(pipe?.lead_id).toBe(lead!.id);
  });

  it('same lead can have two distinct deals in the same pipeline', async () => {
    expect(createdLeadIds).toHaveLength(1);
    const leadId = createdLeadIds[0];
    const { data: second, error } = await supabase.from('pipeline_entries').insert({
      lead_id: leadId, organization_id: TEST_ORG_ID,
      pipeline_id: pipelineId, stage_key: 'novo',
    }).select('id').single();
    expect(error).toBeNull();
    const { data: entries, error: readError } = await supabase.from('pipeline_entries')
      .select('id').eq('organization_id', TEST_ORG_ID)
      .eq('pipeline_id', pipelineId).eq('lead_id', leadId);
    expect(readError).toBeNull();
    expect(entries).toHaveLength(2);
    expect(new Set(entries!.map(entry => entry.id)).size).toBe(2);
    expect(entries!.map(entry => entry.id)).toContain(second!.id);
  });
});
