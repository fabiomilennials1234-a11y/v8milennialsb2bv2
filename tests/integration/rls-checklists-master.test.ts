// @vitest-environment node
/**
 * RLS: Master ghost on checklists / checklist_items.
 *
 * Regression for the bug where a MASTER user could not create a checklist in an
 * org where they are NOT a team_member: checklists/checklist_items had RLS on
 * but had LOST their master_ghost_* policies (present on sibling tables like
 * acoes_do_dia, custom_pipe_entries, leads, pipeline_entries). The only INSERT
 * policy was org-member (organization_id IN get_my_organization_ids()), and a
 * master is not a team_member of the target org, so INSERT was rejected.
 *
 * Migration: supabase/migrations/20261114000000_master_ghost_rls_checklists.sql
 *
 * Seed facts (supabase/seed.sql):
 *   - master@test.com (TEST_MASTER_ID) is a master_user.
 *   - master is a real team_member of Org A only — NO membership in Org B.
 *   - admin@test.com is org-admin + team_member of Org A, and is NOT a master.
 *
 * Org B is therefore the org where master is "not a member".
 *
 * Prerequisites: `supabase start` running + `supabase db reset` (seed applied).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  supabase as svc,
  TEST_ORG_B_ID,
  TEST_MASTER_ID,
} from './setup';
import {
  getMaster,
  getOrgAAdmin,
  clearClients,
} from './rls-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

const shouldSkip =
  !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

describe.skipIf(shouldSkip)('RLS: master ghost on checklists', () => {
  let master: SupabaseClient;
  let adminA: SupabaseClient;

  // IDs of rows created during the suite, cleaned up via service_role in afterAll.
  const createdChecklistIds: string[] = [];

  beforeAll(async () => {
    [master, adminA] = await Promise.all([getMaster(), getOrgAAdmin()]);

    // Ensure master is genuinely NOT a team_member of Org B (a sibling suite,
    // master-first-class, may have provisioned a shadow member). The whole
    // point of this regression is that the master ghost path works WITHOUT any
    // team membership in the target org.
    await svc
      .from('team_members')
      .delete()
      .eq('user_id', TEST_MASTER_ID)
      .eq('organization_id', TEST_ORG_B_ID);
  });

  afterAll(async () => {
    if (createdChecklistIds.length > 0) {
      // ON DELETE CASCADE on checklist_items handles children.
      await svc.from('checklists').delete().in('id', createdChecklistIds);
    }
    await clearClients();
  });

  it('master is NOT a team_member of Org B (precondition)', async () => {
    const { count, error } = await svc
      .from('team_members')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', TEST_MASTER_ID)
      .eq('organization_id', TEST_ORG_B_ID);
    expect(error).toBeNull();
    expect(count).toBe(0);
  });

  it('master CAN insert a checklist in Org B (not a member)', async () => {
    const { data, error } = await master
      .from('checklists')
      .insert({
        organization_id: TEST_ORG_B_ID,
        title: 'Master ghost checklist',
        created_by: null,
      })
      .select('id, organization_id')
      .single();

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.organization_id).toBe(TEST_ORG_B_ID);
    createdChecklistIds.push(data!.id);
  });

  it('master CAN select that checklist back from Org B', async () => {
    const id = createdChecklistIds[0];
    expect(id).toBeTruthy();

    const { data, error } = await master
      .from('checklists')
      .select('id, title')
      .eq('id', id)
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBe(id);
  });

  it('master CAN insert a checklist_item under the Org B checklist', async () => {
    const checklistId = createdChecklistIds[0];
    expect(checklistId).toBeTruthy();

    const { data, error } = await master
      .from('checklist_items')
      .insert({
        checklist_id: checklistId,
        title: 'Master ghost item',
      })
      .select('id')
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
  });

  it('non-master member of Org A CANNOT insert a checklist into Org B', async () => {
    const { data, error } = await adminA
      .from('checklists')
      .insert({
        organization_id: TEST_ORG_B_ID,
        title: 'Cross-tenant attempt',
        created_by: null,
      })
      .select('id');

    // RLS WITH CHECK rejects: org-member policy fails (not member of B) and
    // master_ghost fails (not a master) → violation, no row returned.
    expect(error).not.toBeNull();
    expect(data).toBeNull();

    // Defensive cleanup in the (failing) event a row slipped through.
    if (data && Array.isArray(data) && data.length > 0) {
      await svc.from('checklists').delete().eq('id', (data[0] as { id: string }).id);
    }
  });

  it('non-master member of Org A sees 0 checklists from Org B', async () => {
    const { data, error } = await adminA
      .from('checklists')
      .select('id')
      .eq('organization_id', TEST_ORG_B_ID);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
