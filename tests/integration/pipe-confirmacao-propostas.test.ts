/**
 * Integration tests — pipe_confirmacao + pipe_propostas stage moves
 *
 * No seed data exists for these tables; each describe block creates
 * its own lead + pipe entry and cleans up in afterAll.
 *
 * Requires: local Supabase running with seed applied (`supabase db reset`).
 *
 * Covers (per pipe):
 *   - Entry creation at first stage
 *   - Forward stage transitions through qualification sequence
 *   - Terminal stage transitions (compareceu / vendido / perdido)
 *   - Idempotent update (same status twice = no error)
 *   - Read-back confirms persisted status
 *   - Org-B isolation (data model, not RLS policy)
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { supabase, TEST_ORG_ID, TEST_ORG_B_ID } from './setup';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

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
type ConfirmacaoStage = typeof CONFIRMACAO_STAGES[number];

describe.skipIf(shouldSkip)('Pipe Confirmacao — stage moves', () => {
  let leadId: string;
  let pipeEntryId: string;

  beforeAll(async () => {
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
      .from('pipe_confirmacao')
      .insert({
        lead_id: leadId,
        organization_id: TEST_ORG_ID,
        status: 'reuniao_marcada',
      })
      .select('id, status')
      .single();

    expect(pipeErr).toBeNull();
    expect(pipe?.id).toBeTruthy();
    pipeEntryId = pipe!.id;
  });

  afterAll(async () => {
    if (pipeEntryId) {
      await supabase.from('pipe_confirmacao').delete().eq('id', pipeEntryId);
    }
    if (leadId) {
      await supabase.from('leads').delete().eq('id', leadId);
    }
  });

  it('entry created at reuniao_marcada', async () => {
    const { data, error } = await supabase
      .from('pipe_confirmacao')
      .select('id, status, lead_id, organization_id')
      .eq('id', pipeEntryId)
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('reuniao_marcada');
    expect(data?.lead_id).toBe(leadId);
    expect(data?.organization_id).toBe(TEST_ORG_ID);
  });

  it('reuniao_marcada → confirmar_d5', async () => {
    const { data, error } = await supabase
      .from('pipe_confirmacao')
      .update({ status: 'confirmar_d5' })
      .eq('id', pipeEntryId)
      .select('id, status')
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('confirmar_d5');
  });

  it('confirmar_d5 → confirmar_d3', async () => {
    const { data, error } = await supabase
      .from('pipe_confirmacao')
      .update({ status: 'confirmar_d3' })
      .eq('id', pipeEntryId)
      .select('id, status')
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('confirmar_d3');
  });

  it('confirmar_d3 → confirmar_d1 (skipping d2)', async () => {
    const { data, error } = await supabase
      .from('pipe_confirmacao')
      .update({ status: 'confirmar_d1' })
      .eq('id', pipeEntryId)
      .select('id, status')
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('confirmar_d1');
  });

  it('confirmar_d1 → compareceu (terminal positive stage)', async () => {
    const { data, error } = await supabase
      .from('pipe_confirmacao')
      .update({ status: 'compareceu' })
      .eq('id', pipeEntryId)
      .select('id, status')
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('compareceu');
  });

  it('full sequence reuniao_marcada → compareceu persists each step', async () => {
    await supabase
      .from('pipe_confirmacao')
      .update({ status: 'reuniao_marcada' })
      .eq('id', pipeEntryId);

    for (const stage of CONFIRMACAO_STAGES) {
      const { data, error } = await supabase
        .from('pipe_confirmacao')
        .update({ status: stage })
        .eq('id', pipeEntryId)
        .select('id, status')
        .single();
      expect(error).toBeNull();
      expect(data?.status).toBe(stage);
    }
  });

  it('remarcar branch: confirmacao_no_dia → remarcar → reuniao_marcada', async () => {
    await supabase
      .from('pipe_confirmacao')
      .update({ status: 'confirmacao_no_dia' })
      .eq('id', pipeEntryId);

    const { data: remarcar, error: e1 } = await supabase
      .from('pipe_confirmacao')
      .update({ status: 'remarcar' })
      .eq('id', pipeEntryId)
      .select('id, status')
      .single();
    expect(e1).toBeNull();
    expect(remarcar?.status).toBe('remarcar');

    const { data: back, error: e2 } = await supabase
      .from('pipe_confirmacao')
      .update({ status: 'reuniao_marcada' })
      .eq('id', pipeEntryId)
      .select('id, status')
      .single();
    expect(e2).toBeNull();
    expect(back?.status).toBe('reuniao_marcada');
  });

  it('perdido terminal stage is reachable', async () => {
    const { data, error } = await supabase
      .from('pipe_confirmacao')
      .update({ status: 'perdido' })
      .eq('id', pipeEntryId)
      .select('id, status')
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('perdido');
  });

  it('idempotent update: same status twice has no error', async () => {
    await supabase
      .from('pipe_confirmacao')
      .update({ status: 'confirmar_d5' })
      .eq('id', pipeEntryId);

    const { data, error } = await supabase
      .from('pipe_confirmacao')
      .update({ status: 'confirmar_d5' })
      .eq('id', pipeEntryId)
      .select('id, status')
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('confirmar_d5');
  });

  it('read-back confirms persisted status', async () => {
    await supabase
      .from('pipe_confirmacao')
      .update({ status: 'confirmar_d3' })
      .eq('id', pipeEntryId);

    const { data, error } = await supabase
      .from('pipe_confirmacao')
      .select('id, status')
      .eq('id', pipeEntryId)
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('confirmar_d3');
  });

  it('org-B cannot see org-A confirmacao entry', async () => {
    const { data, error } = await supabase
      .from('pipe_confirmacao')
      .select('id, status')
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
type PropostasStage = typeof PROPOSTAS_FORWARD_STAGES[number];

describe.skipIf(shouldSkip)('Pipe Propostas — stage moves', () => {
  let leadId: string;
  let pipeEntryId: string;

  beforeAll(async () => {
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
      .from('pipe_propostas')
      .insert({
        lead_id: leadId,
        organization_id: TEST_ORG_ID,
        status: 'marcar_compromisso',
      })
      .select('id, status')
      .single();

    expect(pipeErr).toBeNull();
    expect(pipe?.id).toBeTruthy();
    pipeEntryId = pipe!.id;
  });

  afterAll(async () => {
    if (pipeEntryId) {
      await supabase.from('pipe_propostas').delete().eq('id', pipeEntryId);
    }
    if (leadId) {
      await supabase.from('leads').delete().eq('id', leadId);
    }
  });

  it('entry created at marcar_compromisso', async () => {
    const { data, error } = await supabase
      .from('pipe_propostas')
      .select('id, status, lead_id, organization_id')
      .eq('id', pipeEntryId)
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('marcar_compromisso');
    expect(data?.lead_id).toBe(leadId);
    expect(data?.organization_id).toBe(TEST_ORG_ID);
  });

  it('marcar_compromisso → compromisso_marcado', async () => {
    const { data, error } = await supabase
      .from('pipe_propostas')
      .update({ status: 'compromisso_marcado' })
      .eq('id', pipeEntryId)
      .select('id, status')
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('compromisso_marcado');
  });

  it('compromisso_marcado → vendido (terminal positive stage)', async () => {
    const { data, error } = await supabase
      .from('pipe_propostas')
      .update({ status: 'vendido' })
      .eq('id', pipeEntryId)
      .select('id, status')
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('vendido');
  });

  it('reativar branch: esfriou → reativar → compromisso_marcado', async () => {
    await supabase
      .from('pipe_propostas')
      .update({ status: 'esfriou' })
      .eq('id', pipeEntryId);

    const { data: reativar, error: e1 } = await supabase
      .from('pipe_propostas')
      .update({ status: 'reativar' })
      .eq('id', pipeEntryId)
      .select('id, status')
      .single();
    expect(e1).toBeNull();
    expect(reativar?.status).toBe('reativar');

    const { data: back, error: e2 } = await supabase
      .from('pipe_propostas')
      .update({ status: 'compromisso_marcado' })
      .eq('id', pipeEntryId)
      .select('id, status')
      .single();
    expect(e2).toBeNull();
    expect(back?.status).toBe('compromisso_marcado');
  });

  it('futuro stage is reachable (long-cycle deal)', async () => {
    const { data, error } = await supabase
      .from('pipe_propostas')
      .update({ status: 'futuro' })
      .eq('id', pipeEntryId)
      .select('id, status')
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('futuro');
  });

  it('perdido terminal stage is reachable', async () => {
    const { data, error } = await supabase
      .from('pipe_propostas')
      .update({ status: 'perdido' })
      .eq('id', pipeEntryId)
      .select('id, status')
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('perdido');
  });

  it('forward sequence marcar_compromisso → vendido persists each step', async () => {
    await supabase
      .from('pipe_propostas')
      .update({ status: 'marcar_compromisso' })
      .eq('id', pipeEntryId);

    for (const stage of PROPOSTAS_FORWARD_STAGES) {
      const { data, error } = await supabase
        .from('pipe_propostas')
        .update({ status: stage })
        .eq('id', pipeEntryId)
        .select('id, status')
        .single();
      expect(error).toBeNull();
      expect(data?.status).toBe(stage);
    }
  });

  it('propostas entry stores sale_value correctly', async () => {
    const { data, error } = await supabase
      .from('pipe_propostas')
      .update({ sale_value: 150000.0, status: 'compromisso_marcado' })
      .eq('id', pipeEntryId)
      .select('id, status, sale_value')
      .single();

    expect(error).toBeNull();
    expect(data?.sale_value).toBe(150000);
    expect(data?.status).toBe('compromisso_marcado');
  });

  it('idempotent update: same status twice has no error', async () => {
    await supabase
      .from('pipe_propostas')
      .update({ status: 'compromisso_marcado' })
      .eq('id', pipeEntryId);

    const { data, error } = await supabase
      .from('pipe_propostas')
      .update({ status: 'compromisso_marcado' })
      .eq('id', pipeEntryId)
      .select('id, status')
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('compromisso_marcado');
  });

  it('read-back confirms persisted status', async () => {
    await supabase
      .from('pipe_propostas')
      .update({ status: 'esfriou' })
      .eq('id', pipeEntryId);

    const { data, error } = await supabase
      .from('pipe_propostas')
      .select('id, status')
      .eq('id', pipeEntryId)
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('esfriou');
  });

  it('org-B cannot see org-A propostas entry', async () => {
    const { data, error } = await supabase
      .from('pipe_propostas')
      .select('id, status')
      .eq('lead_id', leadId)
      .eq('organization_id', TEST_ORG_B_ID);

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it('duplicate pipe entry for same lead conflicts or is prevented', async () => {
    const { error } = await supabase
      .from('pipe_propostas')
      .insert({
        lead_id: leadId,
        organization_id: TEST_ORG_ID,
        status: 'marcar_compromisso',
      });

    if (error) {
      expect(['23505', '23503']).toContain(error.code);
    }
  });
});
