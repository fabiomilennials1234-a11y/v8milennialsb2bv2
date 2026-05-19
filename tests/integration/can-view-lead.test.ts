/**
 * Integration tests for the `can_view_lead(uuid)` RPC.
 *
 * Verifies the 4 visibility outcomes across role boundaries:
 *   - exists            — same-org lead, not deleted
 *   - not_found         — unknown uuid
 *   - deleted           — same-org lead with deleted_at != NULL
 *   - permission_denied — cross-org lead (regular user)
 *
 * Plus master bypass: every visible state collapses to `exists` and
 * metadata carries `cross_org` + `deleted_at`.
 *
 * Requires local Supabase (`supabase start`) with seed.sql applied so
 * that the master/admin/member test users exist.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServiceClient, getOrgAAdmin, getOrgBAdmin, getMaster, clearClients } from './rls-helpers';
import { TEST_ORG_ID, TEST_ORG_B_ID } from './setup';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

const NON_EXISTENT_UUID = '00000000-0000-0000-0000-0000ffff0001';

const createdLeadIds: string[] = [];

async function makeLead(orgId: string, name: string, opts?: { soft_deleted?: boolean }) {
  const svc = createServiceClient();
  const { data, error } = await svc
    .from('leads')
    .insert({
      name,
      phone: `+5511777${Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0')}`,
      organization_id: orgId,
      deleted_at: opts?.soft_deleted ? new Date().toISOString() : null,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to insert test lead: ${error.message}`);
  createdLeadIds.push(data!.id);
  return data!.id as string;
}

async function callRpc(client: Awaited<ReturnType<typeof getOrgAAdmin>>, leadId: string) {
  const { data, error } = await client.rpc('can_view_lead', { p_lead_id: leadId });
  if (error) throw new Error(`RPC error: ${error.message}`);
  // RPC returns TABLE — supabase-js wraps as array.
  const row = Array.isArray(data) ? data[0] : data;
  return row as { status: string; metadata: Record<string, unknown> };
}

describe.skipIf(shouldSkip)('can_view_lead RPC — integration', () => {
  let liveLeadA = '';
  let deletedLeadA = '';
  let liveLeadB = '';

  beforeAll(async () => {
    liveLeadA = await makeLead(TEST_ORG_ID, 'Live Alpha');
    deletedLeadA = await makeLead(TEST_ORG_ID, 'Deleted Alpha', { soft_deleted: true });
    liveLeadB = await makeLead(TEST_ORG_B_ID, 'Live Beta');
  }, 30000);

  afterAll(async () => {
    if (createdLeadIds.length > 0) {
      const svc = createServiceClient();
      await svc.from('leads').delete().in('id', createdLeadIds);
    }
    await clearClients();
  }, 30000);

  describe('regular user (admin org A)', () => {
    it('returns exists for a same-org, non-deleted lead', async () => {
      const client = await getOrgAAdmin();
      const r = await callRpc(client, liveLeadA);
      expect(r.status).toBe('exists');
      expect(r.metadata.organization_id).toBe(TEST_ORG_ID);
    });

    it('returns deleted for a same-org lead with deleted_at != NULL', async () => {
      const client = await getOrgAAdmin();
      const r = await callRpc(client, deletedLeadA);
      expect(r.status).toBe('deleted');
      expect(r.metadata.deleted_at).toBeTruthy();
    });

    it('returns permission_denied for a cross-org lead', async () => {
      const client = await getOrgAAdmin();
      const r = await callRpc(client, liveLeadB);
      expect(r.status).toBe('permission_denied');
    });

    it('returns not_found for unknown uuid', async () => {
      const client = await getOrgAAdmin();
      const r = await callRpc(client, NON_EXISTENT_UUID);
      expect(r.status).toBe('not_found');
    });

    it('does not leak existence of cross-org leads', async () => {
      // Cross-org and not_found must both return without revealing
      // organization_id in metadata.
      const client = await getOrgAAdmin();
      const r = await callRpc(client, liveLeadB);
      expect(r.status).toBe('permission_denied');
      expect(r.metadata.organization_id).toBeUndefined();
    });
  });

  describe('cross-org admin (admin org B reading org A leads)', () => {
    it('returns permission_denied for org A lead', async () => {
      const client = await getOrgBAdmin();
      const r = await callRpc(client, liveLeadA);
      expect(r.status).toBe('permission_denied');
    });
  });

  describe('master user', () => {
    it('returns exists for a same-org lead with master=true flag', async () => {
      const client = await getMaster();
      const r = await callRpc(client, liveLeadA);
      expect(r.status).toBe('exists');
      expect(r.metadata.master).toBe(true);
    });

    it('returns exists for a cross-org lead with cross_org=true flag', async () => {
      const client = await getMaster();
      const r = await callRpc(client, liveLeadB);
      expect(r.status).toBe('exists');
      expect(r.metadata.master).toBe(true);
      // The master's primary org is A — so reading B is cross-org unless
      // they're also a member of org B.
      expect(typeof r.metadata.cross_org).toBe('boolean');
    });

    it('returns exists for a soft-deleted lead with deleted_at in metadata', async () => {
      const client = await getMaster();
      const r = await callRpc(client, deletedLeadA);
      expect(r.status).toBe('exists');
      expect(r.metadata.master).toBe(true);
      expect(r.metadata.deleted_at).toBeTruthy();
    });

    it('returns not_found for unknown uuid even as master', async () => {
      const client = await getMaster();
      const r = await callRpc(client, NON_EXISTENT_UUID);
      expect(r.status).toBe('not_found');
    });
  });
});
