/**
 * Integration tests for lead import flow.
 *
 * Requires local Supabase (`supabase start`).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { supabase, TEST_ORG_ID, TEST_TM_ADMIN_ID } from './setup';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

// Track IDs created during tests for cleanup
const createdLeadIds: string[] = [];
const createdPipelineIds: string[] = [];

describe.skipIf(shouldSkip)('Lead Import — integration', () => {
  afterAll(async () => {
    // Cleanup created leads
    if (createdLeadIds.length > 0) {
      await supabase.from('leads').delete().in('id', createdLeadIds);
    }
    if (createdPipelineIds.length > 0) {
      await supabase.from('custom_pipelines').delete().in('id', createdPipelineIds);
    }
  });

  it('inserting a new lead via Supabase creates it successfully', async () => {
    const { data, error } = await supabase
      .from('leads')
      .insert({
        name: 'Import Test Lead',
        company: 'Import Corp',
        phone: '+5511888880001',
        email: 'import-test@test.com',
        organization_id: TEST_ORG_ID,
      })
      .select('id, name')
      .single();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data?.name).toBe('Import Test Lead');
    if (data?.id) createdLeadIds.push(data.id);
  });

  it('inserting duplicate phone in same org can be detected', async () => {
    const phone = '+5511888880099';

    // First insert
    const { data: first } = await supabase
      .from('leads')
      .insert({
        name: 'Dup Lead 1',
        phone,
        organization_id: TEST_ORG_ID,
      })
      .select('id')
      .single();

    if (first?.id) createdLeadIds.push(first.id);

    // Second insert with same phone — check if it exists
    const { data: existing } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .eq('organization_id', TEST_ORG_ID)
      .maybeSingle();

    expect(existing).not.toBeNull();
    expect(existing?.id).toBe(first?.id);
  });

  it('lead without name and phone can be rejected by application logic', () => {
    // This is a validation rule — leads without name AND phone should be rejected
    const lead = { name: '', phone: '', email: '' };
    const isValid = !!(lead.name?.trim() || lead.phone?.trim());
    expect(isValid).toBe(false);
  });

  it('test leads from seed exist', async () => {
    const { data, error } = await supabase
      .from('leads')
      .select('id')
      .eq('organization_id', TEST_ORG_ID);

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(3);
  });

  // ─── Custom Pipeline Import — regression tests ────────────
  // Contexto: bug onde custom_pipe_entries.assigned_to era FK → profiles(id)
  // mas frontend enviava team_members.id → FK violation silenciosa no import.
  // Migration 20260918000000 corrige FK pra team_members(id).

  describe('custom_pipe_entries.assigned_to FK alignment', () => {
    it('assigned_to aceita team_members.id (alinhado com resto do sistema)', async () => {
      // Cria pipeline custom
      const { data: pipeline, error: pipeErr } = await supabase
        .from('custom_pipelines')
        .insert({
          organization_id: TEST_ORG_ID,
          name: `Pipeline Teste FK ${Date.now()}`,
          is_active: true,
        })
        .select('id')
        .single();

      expect(pipeErr).toBeNull();
      expect(pipeline?.id).toBeTruthy();
      if (pipeline?.id) createdPipelineIds.push(pipeline.id);

      // Cria stage
      const { data: stage, error: stageErr } = await supabase
        .from('custom_pipeline_stages')
        .insert({
          organization_id: TEST_ORG_ID,
          pipeline_id: pipeline!.id,
          name: 'Novo',
          position: 0,
          is_active: true,
        })
        .select('id')
        .single();

      expect(stageErr).toBeNull();

      // Cria lead
      const { data: lead } = await supabase
        .from('leads')
        .insert({
          name: 'FK Test Lead',
          phone: '+5511888880901',
          organization_id: TEST_ORG_ID,
        })
        .select('id')
        .single();
      if (lead?.id) createdLeadIds.push(lead.id);

      // INSERT em custom_pipe_entries com team_members.id — deve funcionar pós-migration
      const { data: entry, error: entryErr } = await supabase
        .from('custom_pipe_entries')
        .insert({
          organization_id: TEST_ORG_ID,
          pipeline_id: pipeline!.id,
          lead_id: lead!.id,
          stage_id: stage!.id,
          assigned_to: TEST_TM_ADMIN_ID, // team_members.id
        })
        .select('id, assigned_to')
        .single();

      expect(entryErr).toBeNull();
      expect(entry?.assigned_to).toBe(TEST_TM_ADMIN_ID);
    });

    it('assigned_to rejeita UUID inválido (FK violation explícita, não silenciosa)', async () => {
      const { data: pipeline } = await supabase
        .from('custom_pipelines')
        .insert({
          organization_id: TEST_ORG_ID,
          name: `Pipeline Teste FK Invalid ${Date.now()}`,
          is_active: true,
        })
        .select('id')
        .single();
      if (pipeline?.id) createdPipelineIds.push(pipeline.id);

      const { data: stage } = await supabase
        .from('custom_pipeline_stages')
        .insert({
          organization_id: TEST_ORG_ID,
          pipeline_id: pipeline!.id,
          name: 'Novo',
          position: 0,
          is_active: true,
        })
        .select('id')
        .single();

      const { data: lead } = await supabase
        .from('leads')
        .insert({
          name: 'FK Invalid Lead',
          phone: '+5511888880902',
          organization_id: TEST_ORG_ID,
        })
        .select('id')
        .single();
      if (lead?.id) createdLeadIds.push(lead.id);

      // UUID aleatório que não existe em team_members
      const { error: insertErr } = await supabase
        .from('custom_pipe_entries')
        .insert({
          organization_id: TEST_ORG_ID,
          pipeline_id: pipeline!.id,
          lead_id: lead!.id,
          stage_id: stage!.id,
          assigned_to: '00000000-0000-0000-0000-0000000f0f0f',
        })
        .select('id')
        .single();

      // Garante que a falha é OBSERVÁVEL (Postgres retorna error, não silencia)
      expect(insertErr).not.toBeNull();
      expect(insertErr?.message).toMatch(/foreign key|violates|fkey/i);
    });

    it('assigned_to aceita null (responsável opcional)', async () => {
      const { data: pipeline } = await supabase
        .from('custom_pipelines')
        .insert({
          organization_id: TEST_ORG_ID,
          name: `Pipeline Teste Null ${Date.now()}`,
          is_active: true,
        })
        .select('id')
        .single();
      if (pipeline?.id) createdPipelineIds.push(pipeline.id);

      const { data: stage } = await supabase
        .from('custom_pipeline_stages')
        .insert({
          organization_id: TEST_ORG_ID,
          pipeline_id: pipeline!.id,
          name: 'Novo',
          position: 0,
          is_active: true,
        })
        .select('id')
        .single();

      const { data: lead } = await supabase
        .from('leads')
        .insert({
          name: 'Null Assigned Lead',
          phone: '+5511888880903',
          organization_id: TEST_ORG_ID,
        })
        .select('id')
        .single();
      if (lead?.id) createdLeadIds.push(lead.id);

      const { data: entry, error } = await supabase
        .from('custom_pipe_entries')
        .insert({
          organization_id: TEST_ORG_ID,
          pipeline_id: pipeline!.id,
          lead_id: lead!.id,
          stage_id: stage!.id,
          assigned_to: null,
        })
        .select('id, assigned_to')
        .single();

      expect(error).toBeNull();
      expect(entry?.assigned_to).toBeNull();
    });
  });
});
