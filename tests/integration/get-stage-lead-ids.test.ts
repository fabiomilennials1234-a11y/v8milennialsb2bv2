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
  TEST_ORG_B_ID,
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
const PIPELINE_A_ID = '00000000-0000-0000-0000-0000000703a1';
const PIPELINE_B_ID = '00000000-0000-0000-0000-0000000703b1';

describe.skipIf(shouldSkip)('get_stage_lead_ids RPC', () => {
  let adminA: SupabaseClient;
  let adminB: SupabaseClient;

  beforeAll(async () => {
    [adminA, adminB] = await Promise.all([getOrgAAdmin(), getOrgBAdmin()]);

    // System pipelines (slug 'whatsapp') for both orgs.
    await supabase.from('pipelines').upsert(
      [
        {
          id: PIPELINE_A_ID,
          organization_id: TEST_ORG_ID,
          name: 'WhatsApp',
          slug: 'whatsapp',
          type: 'system',
        },
        {
          id: PIPELINE_B_ID,
          organization_id: TEST_ORG_B_ID,
          name: 'WhatsApp',
          slug: 'whatsapp',
          type: 'system',
        },
      ],
      { onConflict: 'id' },
    );

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
    await supabase
      .from('pipeline_entries')
      .delete()
      .in('pipeline_id', [PIPELINE_A_ID, PIPELINE_B_ID]);
    await supabase.from('pipelines').delete().in('id', [PIPELINE_A_ID, PIPELINE_B_ID]);
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
});
