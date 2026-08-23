// @vitest-environment node
/**
 * Integration tests — get_filtered_lead_ids RPC (issue #705, Disparo "Filtro
 * ativo").
 *
 * Verifies the "Leads matching the board's active filter" audience resolver that
 * feeds the Quick Blast engine:
 *   (a) returns ALL matching lead_ids across the whole pipeline (not a page,
 *       not a single stage) when no filters are applied;
 *   (b) SEARCH dimension narrows correctly (mirrors get_pipeline_page: ILIKE on
 *       name / phone / company);
 *   (c) RESPONSIBLE dimension narrows correctly (lead pre/sale responsible);
 *   (d) optional p_stage_key scopes to a single stage;
 *   (e) excludes soft-deleted leads (leads.deleted_at IS NOT NULL);
 *   (f) ORG ISOLATION — org A's leads return nothing for a caller in org B, and
 *       vice-versa, because tenancy is server-derived from auth
 *       (get_my_organization_ids), never from the client.
 *
 * Mirrors get-stage-lead-ids.test.ts: self-seeds pipelines + pipeline_entries
 * via the service client, then calls the RPC as authenticated org-A / org-B
 * admins so RLS + the SECURITY DEFINER tenancy helper are exercised for real.
 *
 * Prerequisites:
 *   1. `supabase start` running
 *   2. Seed applied (`supabase db reset`)
 *   3. Migration 20261120000000_get_filtered_lead_ids_rpc.sql applied
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  supabase, // service-role client — setup/teardown only
  TEST_ORG_ID,
  getSystemPipelineId,
  restoreSeedWhatsappEntries,
  TEST_ORG_B_ID,
  TEST_TM_MEMBER_1_ID,
  TEST_LEAD_ALPHA_ID,
  TEST_LEAD_BETA_ID,
  TEST_LEAD_GAMMA_ID,
  TEST_LEAD_ORGB_1_ID,
} from './setup';
import { getOrgAAdmin, getOrgBAdmin, clearClients } from './rls-helpers';
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

describe.skipIf(shouldSkip)('get_filtered_lead_ids RPC', () => {
  let adminA: SupabaseClient;
  let adminB: SupabaseClient;

  beforeAll(async () => {
    [adminA, adminB] = await Promise.all([getOrgAAdmin(), getOrgBAdmin()]);

    // System pipelines (slug 'whatsapp') for both orgs.
    [PIPELINE_A_ID, PIPELINE_B_ID] = await Promise.all([
      getSystemPipelineId(TEST_ORG_ID, 'whatsapp'),
      getSystemPipelineId(TEST_ORG_B_ID, 'whatsapp'),
    ]);

    // Org A leads:
    //   Alpha (company "Alpha Corp") + Beta (company "Beta Inc") in STAGE,
    //   Gamma (company "Gamma Ltd") in OTHER_STAGE.
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

    // Responsible dimension: assign Alpha to MEMBER_1 (sale_responsible_id).
    await supabase
      .from('leads')
      .update({ sale_responsible_id: TEST_TM_MEMBER_1_ID })
      .eq('id', TEST_LEAD_ALPHA_ID);
    await supabase
      .from('leads')
      .update({ sale_responsible_id: null })
      .in('id', [TEST_LEAD_BETA_ID, TEST_LEAD_GAMMA_ID]);
  });

  afterAll(async () => {
    await restoreSeedWhatsappEntries();
    // Undo fixture mutations.
    await supabase
      .from('leads')
      .update({ sale_responsible_id: null, deleted_at: null, deleted_by: null })
      .in('id', [TEST_LEAD_ALPHA_ID, TEST_LEAD_BETA_ID, TEST_LEAD_GAMMA_ID]);
    await clearClients();
  });

  it('(a) returns ALL matching lead_ids across the whole pipeline (no filter, no stage)', async () => {
    const { data, error } = await adminA.rpc('get_filtered_lead_ids', {
      p_pipeline_type: 'whatsapp',
      p_stage_key: null,
      p_search: null,
      p_responsible_id: null,
      p_tag_ids: null,
    });
    expect(error).toBeNull();
    const ids = (data as string[]) ?? [];
    // Every org-A lead in the pipeline, across BOTH stages.
    expect(new Set(ids)).toEqual(
      new Set([TEST_LEAD_ALPHA_ID, TEST_LEAD_BETA_ID, TEST_LEAD_GAMMA_ID]),
    );
  });

  it('(b) SEARCH dimension narrows correctly (company ILIKE)', async () => {
    const { data, error } = await adminA.rpc('get_filtered_lead_ids', {
      p_pipeline_type: 'whatsapp',
      p_stage_key: null,
      p_search: 'Alpha',
      p_responsible_id: null,
      p_tag_ids: null,
    });
    expect(error).toBeNull();
    expect((data as string[]) ?? []).toEqual([TEST_LEAD_ALPHA_ID]);
  });

  it('(c) RESPONSIBLE dimension narrows correctly', async () => {
    const { data, error } = await adminA.rpc('get_filtered_lead_ids', {
      p_pipeline_type: 'whatsapp',
      p_stage_key: null,
      p_search: null,
      p_responsible_id: TEST_TM_MEMBER_1_ID,
      p_tag_ids: null,
    });
    expect(error).toBeNull();
    expect((data as string[]) ?? []).toEqual([TEST_LEAD_ALPHA_ID]);
  });

  it('(d) optional p_stage_key scopes to a single stage', async () => {
    const { data, error } = await adminA.rpc('get_filtered_lead_ids', {
      p_pipeline_type: 'whatsapp',
      p_stage_key: STAGE,
      p_search: null,
      p_responsible_id: null,
      p_tag_ids: null,
    });
    expect(error).toBeNull();
    const ids = (data as string[]) ?? [];
    // STAGE has Alpha + Beta; Gamma (OTHER_STAGE) excluded.
    expect(new Set(ids)).toEqual(new Set([TEST_LEAD_ALPHA_ID, TEST_LEAD_BETA_ID]));
  });

  it('(e) excludes soft-deleted leads', async () => {
    await supabase
      .from('leads')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', TEST_LEAD_BETA_ID);

    const { data, error } = await adminA.rpc('get_filtered_lead_ids', {
      p_pipeline_type: 'whatsapp',
      p_stage_key: STAGE,
      p_search: null,
      p_responsible_id: null,
      p_tag_ids: null,
    });
    expect(error).toBeNull();
    expect((data as string[]) ?? []).toEqual([TEST_LEAD_ALPHA_ID]);

    // restore for the isolation test below
    await supabase
      .from('leads')
      .update({ deleted_at: null, deleted_by: null })
      .eq('id', TEST_LEAD_BETA_ID);
  });

  it('(f) ORG ISOLATION — org B caller gets nothing for org A pipeline', async () => {
    // Org B has its own OrgB-1; it must NOT see org A leads, and org A must NOT
    // see OrgB-1. Tenancy is server-derived, not client-supplied.
    const [resB, resA] = await Promise.all([
      adminB.rpc('get_filtered_lead_ids', {
        p_pipeline_type: 'whatsapp',
        p_stage_key: null,
        p_search: null,
        p_responsible_id: null,
        p_tag_ids: null,
      }),
      adminA.rpc('get_filtered_lead_ids', {
        p_pipeline_type: 'whatsapp',
        p_stage_key: null,
        p_search: null,
        p_responsible_id: null,
        p_tag_ids: null,
      }),
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
});
