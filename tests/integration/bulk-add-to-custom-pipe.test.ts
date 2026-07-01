/**
 * Integration tests — bulk_add_to_custom_pipe RPC
 *
 * Cobre a feature "Mover leads em massa para um FUNIL CUSTOM" pelo BulkActionBar.
 * A RPC é SECURITY DEFINER e resolve a org POR LEAD (nunca confia em input de org),
 * espelhando o idioma de bulk_move_stage.
 *
 * Requires: local Supabase running with seed applied (`supabase db reset`).
 *
 * Covers:
 *   - Membro move leads da PRÓPRIA org para um funil custom da própria org (insere)
 *   - Upsert on-conflict: lead já no funil → atualiza etapa, sem erro de duplicata
 *   - Isolamento por org: membro NÃO move lead de outra org (no-op)
 *   - Isolamento por org: funil de outra org não é destino válido (no-op)
 *   - Master cross-org: move lead de outra org para funil daquela org (OK)
 *   - Pipeline/stage inexistentes → no-op (sem erro)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  supabase,
  TEST_ORG_ID,
  TEST_ORG_B_ID,
  TEST_LEAD_ALPHA_ID,
  TEST_LEAD_BETA_ID,
  TEST_LEAD_GAMMA_ID,
  TEST_LEAD_ORGB_1_ID,
} from './setup';
import {
  getMaster,
  getOrgAMember1,
  clearClients,
  createServiceClient,
} from './rls-helpers';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

const RANDOM_UUID = '99999999-9999-9999-9999-999999999999';

// IDs fixos para os funis/etapas de teste (facilita cleanup + asserts).
const PIPE_A_ID = 'aaaaaaaa-0000-0000-0000-0000000000a1';
const PIPE_A_STAGE_1 = 'aaaaaaaa-0000-0000-0000-0000000000a2';
const PIPE_A_STAGE_2 = 'aaaaaaaa-0000-0000-0000-0000000000a3';
const PIPE_B_ID = 'bbbbbbbb-0000-0000-0000-0000000000b1';
const PIPE_B_STAGE_1 = 'bbbbbbbb-0000-0000-0000-0000000000b2';

const svc = createServiceClient();

async function entryFor(pipelineId: string, leadId: string) {
  return svc
    .from('custom_pipe_entries')
    .select('id, stage_id, organization_id')
    .eq('pipeline_id', pipelineId)
    .eq('lead_id', leadId)
    .maybeSingle();
}

describe.skipIf(shouldSkip)('bulk_add_to_custom_pipe RPC', () => {
  beforeAll(async () => {
    // Funis custom de teste (org A e org B) + etapas. Idempotente via upsert.
    await svc.from('custom_pipelines').upsert([
      {
        id: PIPE_A_ID,
        organization_id: TEST_ORG_ID,
        name: 'Bulk Custom A',
        slug: 'bulk-custom-a',
        is_active: true,
      },
      {
        id: PIPE_B_ID,
        organization_id: TEST_ORG_B_ID,
        name: 'Bulk Custom B',
        slug: 'bulk-custom-b',
        is_active: true,
      },
    ]);

    await svc.from('custom_pipeline_stages').upsert([
      {
        id: PIPE_A_STAGE_1,
        organization_id: TEST_ORG_ID,
        pipeline_id: PIPE_A_ID,
        stage_key: 'novo',
        name: 'Novo',
        position: 0,
      },
      {
        id: PIPE_A_STAGE_2,
        organization_id: TEST_ORG_ID,
        pipeline_id: PIPE_A_ID,
        stage_key: 'andamento',
        name: 'Em andamento',
        position: 1,
      },
      {
        id: PIPE_B_STAGE_1,
        organization_id: TEST_ORG_B_ID,
        pipeline_id: PIPE_B_ID,
        stage_key: 'novo',
        name: 'Novo',
        position: 0,
      },
    ]);

    // Estado limpo: remove qualquer entry pré-existente dos funis de teste.
    await svc.from('custom_pipe_entries').delete().in('pipeline_id', [PIPE_A_ID, PIPE_B_ID]);
  });

  afterAll(async () => {
    // Cascade: deletar os pipelines remove stages + entries.
    await svc.from('custom_pipe_entries').delete().in('pipeline_id', [PIPE_A_ID, PIPE_B_ID]);
    await svc.from('custom_pipelines').delete().in('id', [PIPE_A_ID, PIPE_B_ID]);
    await clearClients();
  });

  it('membro move leads da própria org para funil custom (insere na etapa)', async () => {
    const member = await getOrgAMember1();
    const { error } = await member.rpc('bulk_add_to_custom_pipe', {
      p_lead_ids: [TEST_LEAD_ALPHA_ID, TEST_LEAD_BETA_ID],
      p_pipeline_id: PIPE_A_ID,
      p_stage_id: PIPE_A_STAGE_1,
    });
    expect(error).toBeNull();

    const alpha = await entryFor(PIPE_A_ID, TEST_LEAD_ALPHA_ID);
    const beta = await entryFor(PIPE_A_ID, TEST_LEAD_BETA_ID);
    expect(alpha.data?.stage_id).toBe(PIPE_A_STAGE_1);
    expect(alpha.data?.organization_id).toBe(TEST_ORG_ID);
    expect(beta.data?.stage_id).toBe(PIPE_A_STAGE_1);
  });

  it('upsert on-conflict: lead já no funil vira update de etapa (sem erro de dup)', async () => {
    const member = await getOrgAMember1();
    // ALPHA já está em PIPE_A_STAGE_1 (teste anterior). Reenviar em outra etapa.
    const { error } = await member.rpc('bulk_add_to_custom_pipe', {
      p_lead_ids: [TEST_LEAD_ALPHA_ID],
      p_pipeline_id: PIPE_A_ID,
      p_stage_id: PIPE_A_STAGE_2,
    });
    expect(error).toBeNull();

    const alpha = await entryFor(PIPE_A_ID, TEST_LEAD_ALPHA_ID);
    expect(alpha.data?.stage_id).toBe(PIPE_A_STAGE_2);

    // Continua sendo UMA única entry (não duplicou).
    const { count } = await svc
      .from('custom_pipe_entries')
      .select('id', { count: 'exact', head: true })
      .eq('pipeline_id', PIPE_A_ID)
      .eq('lead_id', TEST_LEAD_ALPHA_ID);
    expect(count).toBe(1);
  });

  it('isolamento: membro NÃO move lead de outra org (no-op)', async () => {
    const member = await getOrgAMember1();
    const { error } = await member.rpc('bulk_add_to_custom_pipe', {
      p_lead_ids: [TEST_LEAD_ORGB_1_ID],
      p_pipeline_id: PIPE_A_ID,
      p_stage_id: PIPE_A_STAGE_1,
    });
    // Não deve lançar — apenas ignora o lead sem permissão.
    expect(error).toBeNull();

    const orgbLead = await entryFor(PIPE_A_ID, TEST_LEAD_ORGB_1_ID);
    expect(orgbLead.data).toBeNull();
  });

  it('isolamento: funil de outra org não é destino válido para lead da própria org (no-op)', async () => {
    const member = await getOrgAMember1();
    const { error } = await member.rpc('bulk_add_to_custom_pipe', {
      p_lead_ids: [TEST_LEAD_GAMMA_ID],
      p_pipeline_id: PIPE_B_ID, // funil da org B
      p_stage_id: PIPE_B_STAGE_1,
    });
    expect(error).toBeNull();

    const gamma = await entryFor(PIPE_B_ID, TEST_LEAD_GAMMA_ID);
    expect(gamma.data).toBeNull();
  });

  it('master cross-org: move lead de outra org para funil daquela org (OK)', async () => {
    const master = await getMaster();
    const { error } = await master.rpc('bulk_add_to_custom_pipe', {
      p_lead_ids: [TEST_LEAD_ORGB_1_ID],
      p_pipeline_id: PIPE_B_ID,
      p_stage_id: PIPE_B_STAGE_1,
    });
    expect(error).toBeNull();

    const entry = await entryFor(PIPE_B_ID, TEST_LEAD_ORGB_1_ID);
    expect(entry.data?.stage_id).toBe(PIPE_B_STAGE_1);
    expect(entry.data?.organization_id).toBe(TEST_ORG_B_ID);
  });

  it('pipeline inexistente → no-op (sem erro)', async () => {
    const member = await getOrgAMember1();
    const { error } = await member.rpc('bulk_add_to_custom_pipe', {
      p_lead_ids: [TEST_LEAD_ALPHA_ID],
      p_pipeline_id: RANDOM_UUID,
      p_stage_id: PIPE_A_STAGE_1,
    });
    expect(error).toBeNull();

    const entry = await entryFor(RANDOM_UUID, TEST_LEAD_ALPHA_ID);
    expect(entry.data).toBeNull();
  });

  it('stage que não pertence ao pipeline → no-op (sem erro)', async () => {
    const member = await getOrgAMember1();
    // GAMMA ainda não está em PIPE_A. Usar stage da org B (não pertence a PIPE_A).
    const { error } = await member.rpc('bulk_add_to_custom_pipe', {
      p_lead_ids: [TEST_LEAD_GAMMA_ID],
      p_pipeline_id: PIPE_A_ID,
      p_stage_id: PIPE_B_STAGE_1,
    });
    expect(error).toBeNull();

    const gamma = await entryFor(PIPE_A_ID, TEST_LEAD_GAMMA_ID);
    expect(gamma.data).toBeNull();
  });
});
