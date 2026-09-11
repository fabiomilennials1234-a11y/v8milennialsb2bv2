/**
 * Integration tests — confirmation and proposal pipeline_entries stage moves
 *
 * No seed data exists for these tables; each describe block creates
 * its own lead + pipe entry and cleans up in afterAll.
 *
 * Requires: local Supabase running with seed applied (`supabase db reset`).
 *
 * Covers (per pipe):
 *   - Entry creation at first stage
 *   - Forward stage transitions through qualification sequence
 *   - Named column transitions (compareceu / vendido / perdido); no outcome mutation
 *   - Idempotent update (same status twice = no error)
 *   - Read-back confirms persisted status
 *   - Org-B isolation (data model, not RLS policy)
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { supabase, TEST_ORG_ID, TEST_ORG_B_ID, getSystemPipelineId } from './setup';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';


async function prepareStages(slug: 'confirmacao' | 'propostas', keys: readonly string[], added: string[]) {
  const pipelineId = await getSystemPipelineId(TEST_ORG_ID, slug);
  const { data: stages, error } = await supabase.from('pipeline_stages')
    .select('stage_key, position').eq('organization_id', TEST_ORG_ID).eq('pipeline_id', pipelineId);
  expect(error).toBeNull();
  let position = Math.max(-1, ...(stages ?? []).map(stage => stage.position));
  for (const stageKey of keys) {
    if (stages?.some(stage => stage.stage_key === stageKey)) continue;
    const { data, error: insertError } = await supabase.from('pipeline_stages').insert({
      organization_id: TEST_ORG_ID, pipeline_id: pipelineId,
      stage_key: stageKey, name: stageKey, position: ++position, stage_role: 'open',
    }).select('id').single();
    expect(insertError).toBeNull();
    added.push(data!.id);
  }
  return pipelineId;
}

// ─── pipe_confirmacao ────────────────────────────────────────────────────────

const CONFIRMACAO_STAGES = [
  'reuniao_marcada',
  'confirmar_d5',
  'confirmar_d3',
  'confirmar_d2',
  'confirmar_d1',
  'confirmacao_no_dia',
  'compareceu',
] as const;


describe.skipIf(shouldSkip)('Pipe Confirmacao — stage moves', () => {
  let leadId: string;
  let pipeEntryId: string;
  let pipelineId: string;
  const addedStageIds: string[] = [];

  beforeAll(async () => {
    pipelineId = await prepareStages('confirmacao', [...CONFIRMACAO_STAGES, 'remarcar', 'perdido'], addedStageIds);
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .insert({
        name: 'Integration Test — Confirmacao',
        phone: '+5511900002222',
        organization_id: TEST_ORG_ID,
      })
      .select('id')
      .single();

    expect(leadErr).toBeNull();
    expect(lead?.id).toBeTruthy();
    leadId = lead!.id;

    const { data: pipe, error: pipeErr } = await supabase
      .from('pipeline_entries')
      .insert({
        lead_id: leadId,
        organization_id: TEST_ORG_ID,
        pipeline_id: pipelineId, stage_key: 'reuniao_marcada',
      })
      .select('id, status:stage_key')
      .single();

    expect(pipeErr).toBeNull();
    expect(pipe?.id).toBeTruthy();
    pipeEntryId = pipe!.id;
  });

  afterAll(async () => {
    if (pipeEntryId) {
      const { error } = await supabase.from('pipeline_entries').delete()
        .eq('organization_id', TEST_ORG_ID).eq('pipeline_id', pipelineId).eq('lead_id', leadId);
      expect(error).toBeNull();
    }
    if (leadId) {
      const { error } = await supabase.from('leads').delete().eq('id', leadId);
      expect(error).toBeNull();
    }
    if (addedStageIds.length) {
      const { error } = await supabase.from('pipeline_stages').delete().in('id', addedStageIds);
      expect(error).toBeNull();
    }
  });

  it('entry created at reuniao_marcada', async () => {
    const { data, error } = await supabase
      .from('pipeline_entries')
      .select('id, status:stage_key, lead_id, organization_id')
      .eq('id', pipeEntryId)
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('reuniao_marcada');
    expect(data?.lead_id).toBe(leadId);
    expect(data?.organization_id).toBe(TEST_ORG_ID);
  });

  it('reuniao_marcada → confirmar_d5', async () => {
    const { data, error } = await supabase
      .from('pipeline_entries')
      .update({ stage_key: 'confirmar_d5' })
      .eq('id', pipeEntryId)
      .select('id, status:stage_key')
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('confirmar_d5');
  });

  it('confirmar_d5 → confirmar_d3', async () => {
    const { data, error } = await supabase
      .from('pipeline_entries')
      .update({ stage_key: 'confirmar_d3' })
      .eq('id', pipeEntryId)
      .select('id, status:stage_key')
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('confirmar_d3');
  });

  it('confirmar_d3 → confirmar_d1 (skipping d2)', async () => {
    const { data, error } = await supabase
      .from('pipeline_entries')
      .update({ stage_key: 'confirmar_d1' })
      .eq('id', pipeEntryId)
      .select('id, status:stage_key')
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('confirmar_d1');
  });

  it('confirmar_d1 → compareceu (column only; outcome is independent)', async () => {
    const { data, error } = await supabase
      .from('pipeline_entries')
      .update({ stage_key: 'compareceu' })
      .eq('id', pipeEntryId)
      .select('id, status:stage_key')
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('compareceu');
  });

  it('full sequence reuniao_marcada → compareceu persists each step', async () => {
    await supabase
      .from('pipeline_entries')
      .update({ stage_key: 'reuniao_marcada' })
      .eq('id', pipeEntryId);

    for (const stage of CONFIRMACAO_STAGES) {
      const { data, error } = await supabase
        .from('pipeline_entries')
        .update({ stage_key: stage })
        .eq('id', pipeEntryId)
        .select('id, status:stage_key')
        .single();
      expect(error).toBeNull();
      expect(data?.status).toBe(stage);
    }
  });

  it('remarcar branch: confirmacao_no_dia → remarcar → reuniao_marcada', async () => {
    await supabase
      .from('pipeline_entries')
      .update({ stage_key: 'confirmacao_no_dia' })
      .eq('id', pipeEntryId);

    const { data: remarcar, error: e1 } = await supabase
      .from('pipeline_entries')
      .update({ stage_key: 'remarcar' })
      .eq('id', pipeEntryId)
      .select('id, status:stage_key')
      .single();
    expect(e1).toBeNull();
    expect(remarcar?.status).toBe('remarcar');

    const { data: back, error: e2 } = await supabase
      .from('pipeline_entries')
      .update({ stage_key: 'reuniao_marcada' })
      .eq('id', pipeEntryId)
      .select('id, status:stage_key')
      .single();
    expect(e2).toBeNull();
    expect(back?.status).toBe('reuniao_marcada');
  });

  it('perdido column is reachable', async () => {
    const { data, error } = await supabase
      .from('pipeline_entries')
      .update({ stage_key: 'perdido' })
      .eq('id', pipeEntryId)
      .select('id, status:stage_key')
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('perdido');
  });

  it('idempotent update: same status twice has no error', async () => {
    await supabase
      .from('pipeline_entries')
      .update({ stage_key: 'confirmar_d5' })
      .eq('id', pipeEntryId);

    const { data, error } = await supabase
      .from('pipeline_entries')
      .update({ stage_key: 'confirmar_d5' })
      .eq('id', pipeEntryId)
      .select('id, status:stage_key')
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('confirmar_d5');
  });

  it('read-back confirms persisted status', async () => {
    await supabase
      .from('pipeline_entries')
      .update({ stage_key: 'confirmar_d3' })
      .eq('id', pipeEntryId);

    const { data, error } = await supabase
      .from('pipeline_entries')
      .select('id, status:stage_key')
      .eq('id', pipeEntryId)
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('confirmar_d3');
  });

  it('org-B cannot see org-A confirmacao entry', async () => {
    const { data, error } = await supabase
      .from('pipeline_entries')
      .select('id, status:stage_key')
      .eq('lead_id', leadId)
      .eq('organization_id', TEST_ORG_B_ID);

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });
});

// ─── pipe_propostas ──────────────────────────────────────────────────────────

const PROPOSTAS_FORWARD_STAGES = [
  'marcar_compromisso',
  'compromisso_marcado',
  'vendido',
] as const;


describe.skipIf(shouldSkip)('Pipe Propostas — stage moves', () => {
  let leadId: string;
  let pipeEntryId: string;
  let pipelineId: string;
  const addedStageIds: string[] = [];

  beforeAll(async () => {
    pipelineId = await prepareStages('propostas', [...PROPOSTAS_FORWARD_STAGES, 'esfriou', 'reativar', 'futuro', 'perdido'], addedStageIds);
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .insert({
        name: 'Integration Test — Propostas',
        phone: '+5511900003333',
        organization_id: TEST_ORG_ID,
      })
      .select('id')
      .single();

    expect(leadErr).toBeNull();
    expect(lead?.id).toBeTruthy();
    leadId = lead!.id;

    const { data: pipe, error: pipeErr } = await supabase
      .from('pipeline_entries')
      .insert({
        lead_id: leadId,
        organization_id: TEST_ORG_ID,
        pipeline_id: pipelineId, stage_key: 'marcar_compromisso',
      })
      .select('id, status:stage_key')
      .single();

    expect(pipeErr).toBeNull();
    expect(pipe?.id).toBeTruthy();
    pipeEntryId = pipe!.id;
  });

  afterAll(async () => {
    if (pipeEntryId) {
      const { error } = await supabase.from('pipeline_entries').delete()
        .eq('organization_id', TEST_ORG_ID).eq('pipeline_id', pipelineId).eq('lead_id', leadId);
      expect(error).toBeNull();
    }
    if (leadId) {
      const { error } = await supabase.from('leads').delete().eq('id', leadId);
      expect(error).toBeNull();
    }
    if (addedStageIds.length) {
      const { error } = await supabase.from('pipeline_stages').delete().in('id', addedStageIds);
      expect(error).toBeNull();
    }
  });

  it('entry created at marcar_compromisso', async () => {
    const { data, error } = await supabase
      .from('pipeline_entries')
      .select('id, status:stage_key, lead_id, organization_id')
      .eq('id', pipeEntryId)
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('marcar_compromisso');
    expect(data?.lead_id).toBe(leadId);
    expect(data?.organization_id).toBe(TEST_ORG_ID);
  });

  it('marcar_compromisso → compromisso_marcado', async () => {
    const { data, error } = await supabase
      .from('pipeline_entries')
      .update({ stage_key: 'compromisso_marcado' })
      .eq('id', pipeEntryId)
      .select('id, status:stage_key')
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('compromisso_marcado');
  });

  it('compromisso_marcado → vendido (column only; outcome is independent)', async () => {
    const { data, error } = await supabase
      .from('pipeline_entries')
      .update({ stage_key: 'vendido' })
      .eq('id', pipeEntryId)
      .select('id, status:stage_key')
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('vendido');
  });

  it('reativar branch: esfriou → reativar → compromisso_marcado', async () => {
    await supabase
      .from('pipeline_entries')
      .update({ stage_key: 'esfriou' })
      .eq('id', pipeEntryId);

    const { data: reativar, error: e1 } = await supabase
      .from('pipeline_entries')
      .update({ stage_key: 'reativar' })
      .eq('id', pipeEntryId)
      .select('id, status:stage_key')
      .single();
    expect(e1).toBeNull();
    expect(reativar?.status).toBe('reativar');

    const { data: back, error: e2 } = await supabase
      .from('pipeline_entries')
      .update({ stage_key: 'compromisso_marcado' })
      .eq('id', pipeEntryId)
      .select('id, status:stage_key')
      .single();
    expect(e2).toBeNull();
    expect(back?.status).toBe('compromisso_marcado');
  });

  it('futuro stage is reachable (long-cycle deal)', async () => {
    const { data, error } = await supabase
      .from('pipeline_entries')
      .update({ stage_key: 'futuro' })
      .eq('id', pipeEntryId)
      .select('id, status:stage_key')
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('futuro');
  });

  it('perdido column is reachable', async () => {
    const { data, error } = await supabase
      .from('pipeline_entries')
      .update({ stage_key: 'perdido' })
      .eq('id', pipeEntryId)
      .select('id, status:stage_key')
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('perdido');
  });

  it('forward sequence marcar_compromisso → vendido persists each step', async () => {
    await supabase
      .from('pipeline_entries')
      .update({ stage_key: 'marcar_compromisso' })
      .eq('id', pipeEntryId);

    for (const stage of PROPOSTAS_FORWARD_STAGES) {
      const { data, error } = await supabase
        .from('pipeline_entries')
        .update({ stage_key: stage })
        .eq('id', pipeEntryId)
        .select('id, status:stage_key')
        .single();
      expect(error).toBeNull();
      expect(data?.status).toBe(stage);
    }
  });

  it('propostas entry stores sale_value correctly', async () => {
    const { data, error } = await supabase
      .from('pipeline_entries')
      .update({ metadata: { sale_value: 150000.0 }, stage_key: 'compromisso_marcado' })
      .eq('id', pipeEntryId)
      .select('id, status:stage_key, sale_value:metadata->sale_value')
      .single();

    expect(error).toBeNull();
    expect(data?.sale_value).toBe(150000);
    expect(data?.status).toBe('compromisso_marcado');
  });

  it('idempotent update: same status twice has no error', async () => {
    await supabase
      .from('pipeline_entries')
      .update({ stage_key: 'compromisso_marcado' })
      .eq('id', pipeEntryId);

    const { data, error } = await supabase
      .from('pipeline_entries')
      .update({ stage_key: 'compromisso_marcado' })
      .eq('id', pipeEntryId)
      .select('id, status:stage_key')
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('compromisso_marcado');
  });

  it('read-back confirms persisted status', async () => {
    await supabase
      .from('pipeline_entries')
      .update({ stage_key: 'esfriou' })
      .eq('id', pipeEntryId);

    const { data, error } = await supabase
      .from('pipeline_entries')
      .select('id, status:stage_key')
      .eq('id', pipeEntryId)
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('esfriou');
  });

  it('org-B cannot see org-A propostas entry', async () => {
    const { data, error } = await supabase
      .from('pipeline_entries')
      .select('id, status:stage_key')
      .eq('lead_id', leadId)
      .eq('organization_id', TEST_ORG_B_ID);

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it('same lead can have a second distinct proposal deal', async () => {
    const { data, error } = await supabase.from('pipeline_entries').insert({
      lead_id: leadId, organization_id: TEST_ORG_ID,
      pipeline_id: pipelineId, stage_key: 'marcar_compromisso',
    }).select('id').single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
    expect(data?.id).not.toBe(pipeEntryId);
    const { data: entries, error: readError } = await supabase.from('pipeline_entries')
      .select('id').eq('organization_id', TEST_ORG_ID)
      .eq('pipeline_id', pipelineId).eq('lead_id', leadId);
    expect(readError).toBeNull();
    expect(new Set(entries!.map(entry => entry.id))).toEqual(new Set([pipeEntryId, data!.id]));
  });
});
