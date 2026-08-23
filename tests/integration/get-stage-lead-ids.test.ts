// @vitest-environment node
/**
 * Integration tests — get_stage_lead_ids RPC (issue #703, Disparo F1).
 *
 * Verifies the "all Leads in a Stage" audience resolver that feeds the Quick
 * Blast engine:
 *   (a) returns ALL lead_ids of a stage (not a page) for the caller's org;
 *   (b) filters by stage_key (other stages excluded);
 *   (c) excludes soft-deleted leads (leads.deleted_at IS NOT NULL);
 *   (d) ORG ISOLATION — a stage in org A returns nothing for a caller in org B,
 *       because the RPC derives tenancy server-side from auth
 *       (get_my_organization_ids), never from the client.
 *
 * Self-seeds pipelines + pipeline_entries via the service client (not in the
 * base seed), then calls the RPC as authenticated org-A / org-B admins so RLS +
 * the SECURITY DEFINER tenancy helper are exercised for real.
 *
 * Prerequisites:
 *   1. `supabase start` running
 *   2. Seed applied (`supabase db reset`)
 *   3. Migration 20261119000000_get_stage_lead_ids_rpc.sql applied
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  supabase, // service-role client — setup/teardown only
  TEST_ORG_ID,
  getSystemPipelineId,
  restoreSeedWhatsappEntries,
  TEST_ORG_B_ID,
  TEST_LEAD_ALPHA_ID,
  TEST_LEAD_BETA_ID,
  TEST_LEAD_GAMMA_ID,
  TEST_LEAD_ORGB_1_ID,
} from './setup';
import { getOrgAAdmin, getOrgBAdmin, getOrgAMember1, getMaster, clearClients } from './rls-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

const shouldSkip =
  !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

const STAGE = 'novo';
const OTHER_STAGE = 'abordado';

// Deterministic fixture pipeline ids (system pipelines, slug 'whatsapp').
// ⚠ O funil de sistema é o QUE JÁ EXISTE na org (resolvido em `beforeAll` por
// `getSystemPipelineId`), não um segundo criado aqui. `pipelines` tem
// UNIQUE (organization_id, slug): o upsert antigo, com `onConflict: 'id'` e id
// próprio, batia no índice errado, devolvia 23505 sem ninguém checar, e o funil
// nunca nascia — a RPC então respondia com a linha do seed e a asserção lia
// `Set{1}` contra `Set{2}`. Ver SCRUM-362 e o comentário de getSystemPipelineId.
let PIPELINE_A_ID: string;
let PIPELINE_B_ID: string;

describe.skipIf(shouldSkip)('get_stage_lead_ids RPC', () => {
  let adminA: SupabaseClient;
  let adminB: SupabaseClient;

  beforeAll(async () => {
    [adminA, adminB] = await Promise.all([getOrgAAdmin(), getOrgBAdmin()]);

    // System pipelines (slug 'whatsapp') for both orgs.
    [PIPELINE_A_ID, PIPELINE_B_ID] = await Promise.all([
      getSystemPipelineId(TEST_ORG_ID, 'whatsapp'),
      getSystemPipelineId(TEST_ORG_B_ID, 'whatsapp'),
    ]);

    // Org A: Alpha + Beta in STAGE, Gamma in OTHER_STAGE.
    // Org B: OrgB-1 in STAGE (must stay invisible to org A and vice-versa).
    await supabase
      .from('pipeline_entries')
      .delete()
      .in('pipeline_id', [PIPELINE_A_ID, PIPELINE_B_ID]);
    await supabase.from('pipeline_entries').insert([
      { organization_id: TEST_ORG_ID, pipeline_id: PIPELINE_A_ID, lead_id: TEST_LEAD_ALPHA_ID, stage_key: STAGE },
      { organization_id: TEST_ORG_ID, pipeline_id: PIPELINE_A_ID, lead_id: TEST_LEAD_BETA_ID, stage_key: STAGE },
      { organization_id: TEST_ORG_ID, pipeline_id: PIPELINE_A_ID, lead_id: TEST_LEAD_GAMMA_ID, stage_key: OTHER_STAGE },
      { organization_id: TEST_ORG_B_ID, pipeline_id: PIPELINE_B_ID, lead_id: TEST_LEAD_ORGB_1_ID, stage_key: STAGE },
    ]);
  });

  afterAll(async () => {
    await restoreSeedWhatsappEntries();
    // Undo any soft-delete from the exclusion test.
    await supabase
      .from('leads')
      .update({ deleted_at: null, deleted_by: null })
      .eq('id', TEST_LEAD_BETA_ID);
    await clearClients();
  });

  it('(a) returns ALL lead_ids of the stage for the caller org (not a page)', async () => {
    const { data, error } = await adminA.rpc('get_stage_lead_ids', {
      p_pipeline_type: 'whatsapp',
      p_stage_key: STAGE,
    });
    expect(error).toBeNull();
    const ids = (data as string[]) ?? [];
    expect(new Set(ids)).toEqual(new Set([TEST_LEAD_ALPHA_ID, TEST_LEAD_BETA_ID]));
  });

  it('(b) filters by stage_key — other stages excluded', async () => {
    const { data, error } = await adminA.rpc('get_stage_lead_ids', {
      p_pipeline_type: 'whatsapp',
      p_stage_key: OTHER_STAGE,
    });
    expect(error).toBeNull();
    expect((data as string[]) ?? []).toEqual([TEST_LEAD_GAMMA_ID]);
  });

  it('(c) excludes soft-deleted leads', async () => {
    await supabase
      .from('leads')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', TEST_LEAD_BETA_ID);

    const { data, error } = await adminA.rpc('get_stage_lead_ids', {
      p_pipeline_type: 'whatsapp',
      p_stage_key: STAGE,
    });
    expect(error).toBeNull();
    expect((data as string[]) ?? []).toEqual([TEST_LEAD_ALPHA_ID]);

    // restore for isolation test below
    await supabase
      .from('leads')
      .update({ deleted_at: null, deleted_by: null })
      .eq('id', TEST_LEAD_BETA_ID);
  });

  it('(d) ORG ISOLATION — org B caller gets nothing for org A stage', async () => {
    // Org B has its own OrgB-1 in STAGE; it must NOT see org A leads, and org A
    // must NOT see OrgB-1. Tenancy is server-derived, not client-supplied.
    const [resB, resA] = await Promise.all([
      adminB.rpc('get_stage_lead_ids', { p_pipeline_type: 'whatsapp', p_stage_key: STAGE }),
      adminA.rpc('get_stage_lead_ids', { p_pipeline_type: 'whatsapp', p_stage_key: STAGE }),
    ]);
    expect(resB.error).toBeNull();
    expect(resA.error).toBeNull();

    const idsB = (resB.data as string[]) ?? [];
    const idsA = (resA.data as string[]) ?? [];

    // Org B sees only its own lead.
    expect(idsB).toEqual([TEST_LEAD_ORGB_1_ID]);
    // Org A never sees org B's lead.
    expect(idsA).not.toContain(TEST_LEAD_ORGB_1_ID);
    // Disjoint.
    for (const id of idsB) expect(idsA).not.toContain(id);
  });

  // ── Master-ghost (migration 20261228000000) ──────────────────────────────
  // The master fixture is a team_member of org A but NOT org B. Before the fix,
  // a master operating an org where they have no membership got an empty set
  // (get_my_organization_ids excludes it) — the "Nenhum lead neste estágio" bug.
  // p_organization_id destrava o ramo master server-side, escopado à org pedida.

  it('(e) master WITHOUT p_organization_id does NOT see a non-member org stage (reproduces the ghost)', async () => {
    const master = await getMaster();
    const { data, error } = await master.rpc('get_stage_lead_ids', {
      p_pipeline_type: 'whatsapp',
      p_stage_key: STAGE,
    });
    expect(error).toBeNull();
    // Master só é membro da org A → org B fica invisível sem a org pedida.
    expect((data as string[]) ?? []).not.toContain(TEST_LEAD_ORGB_1_ID);
  });

  it('(f) master WITH p_organization_id sees the requested org B stage', async () => {
    const master = await getMaster();
    const { data, error } = await master.rpc('get_stage_lead_ids', {
      p_pipeline_type: 'whatsapp',
      p_stage_key: STAGE,
      p_organization_id: TEST_ORG_B_ID,
    });
    expect(error).toBeNull();
    const ids = (data as string[]) ?? [];
    // Escopado à org pedida: vê o lead de B, e SÓ o de B (não agrega A).
    expect(ids).toContain(TEST_LEAD_ORGB_1_ID);
    expect(ids).not.toContain(TEST_LEAD_ALPHA_ID);
    expect(ids).not.toContain(TEST_LEAD_GAMMA_ID);
  });

  it('(g) NON-master passing p_organization_id of another org gets nothing (no escalation)', async () => {
    const member = await getOrgAMember1();
    const { data, error } = await member.rpc('get_stage_lead_ids', {
      p_pipeline_type: 'whatsapp',
      p_stage_key: STAGE,
      p_organization_id: TEST_ORG_B_ID,
    });
    expect(error).toBeNull();
    // is_master_user() é false → ramo master inerte → só o helper (org A) vale.
    expect((data as string[]) ?? []).not.toContain(TEST_LEAD_ORGB_1_ID);
  });
});
