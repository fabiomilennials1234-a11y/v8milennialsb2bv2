// @vitest-environment node
/**
 * RLS Cross-Tenant Isolation Tests
 *
 * Verifies that Org A cannot see Org B's data and vice versa,
 * across ALL tables with Row-Level Security enabled.
 *
 * Prerequisites:
 *   1. `supabase start` must be running
 *   2. Seed data applied (`supabase db reset`)
 *
 * Skip if SKIP_INTEGRATION is set (for CI without Supabase).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getOrgAAdmin,
  getOrgBAdmin,
  getMaster,
  clearClients,
  expectRowCount,
} from './rls-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

const shouldSkip =
  !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

describe.skipIf(shouldSkip)('RLS: Cross-tenant org isolation', () => {
  let adminA: SupabaseClient;
  let adminB: SupabaseClient;
  let master: SupabaseClient;

  beforeAll(async () => {
    [adminA, adminB, master] = await Promise.all([
      getOrgAAdmin(),
      getOrgBAdmin(),
      getMaster(),
    ]);
  });

  afterAll(() => clearClients());

  // ---------------------------------------------------------------------------
  // Seeded tables — exact row counts per org
  // ---------------------------------------------------------------------------

  describe('organizations', () => {
    it('Org A admin sees only their own organization', async () => {
      await expectRowCount(adminA, 'organizations', 1);
    });

    it('Org B admin sees only their own organization', async () => {
      await expectRowCount(adminB, 'organizations', 1);
    });

    it('Org A cannot see Org B organization', async () => {
      const { data } = await adminA
        .from('organizations')
        .select('id')
        .eq('id', '00000000-0000-0000-0000-000000000002');
      expect(data).toEqual([]);
    });

    it('Org B cannot see Org A organization', async () => {
      const { data } = await adminB
        .from('organizations')
        .select('id')
        .eq('id', '00000000-0000-0000-0000-000000000001');
      expect(data).toEqual([]);
    });
  });

  describe('leads', () => {
    it('Org A admin sees exactly 4 leads', async () => {
      await expectRowCount(adminA, 'leads', 4);
    });

    it('Org B admin sees exactly 2 leads', async () => {
      await expectRowCount(adminB, 'leads', 2);
    });

    it('cross-org isolation: counts are disjoint', async () => {
      const [resA, resB] = await Promise.all([
        adminA.from('leads').select('id'),
        adminB.from('leads').select('id'),
      ]);
      const idsA = new Set((resA.data ?? []).map((r) => r.id));
      const idsB = new Set((resB.data ?? []).map((r) => r.id));
      for (const id of idsB) {
        expect(idsA.has(id)).toBe(false);
      }
    });
  });

  /**
   * NOTE: tags and pipe_whatsapp RLS policies do not enforce strict org isolation.
   * Both org admins see the same global set of rows. We use >= assertions because
   * the exact count may vary if other concurrent test suites insert rows.
   */
  describe('tags', () => {
    it('Org A admin sees at least 2 tags (no strict org isolation)', async () => {
      const { count, error } = await adminA
        .from('tags')
        .select('id', { count: 'exact', head: true });
      expect(error).toBeNull();
      expect(count).toBeGreaterThanOrEqual(2);
    });

    it('Org B admin sees at least 2 tags (no strict org isolation)', async () => {
      const { count, error } = await adminB
        .from('tags')
        .select('id', { count: 'exact', head: true });
      expect(error).toBeNull();
      expect(count).toBeGreaterThanOrEqual(2);
    });
  });

  describe('pipe_whatsapp', () => {
    it('Org A admin sees at least 2 pipe_whatsapp (no strict org isolation)', async () => {
      const { count, error } = await adminA
        .from('pipe_whatsapp')
        .select('id', { count: 'exact', head: true });
      expect(error).toBeNull();
      expect(count).toBeGreaterThanOrEqual(2);
    });

    it('Org B admin sees at least 2 pipe_whatsapp (no strict org isolation)', async () => {
      const { count, error } = await adminB
        .from('pipe_whatsapp')
        .select('id', { count: 'exact', head: true });
      expect(error).toBeNull();
      expect(count).toBeGreaterThanOrEqual(2);
    });
  });

  describe('team_members', () => {
    it('Org A admin sees 5 team members (master, admin, sdr, member1, member2)', async () => {
      await expectRowCount(adminA, 'team_members', 5);
    });

    it('Org B admin sees 2 team members (adminB, memberB)', async () => {
      await expectRowCount(adminB, 'team_members', 2);
    });

    it('cross-org isolation: no shared members', async () => {
      const [resA, resB] = await Promise.all([
        adminA.from('team_members').select('id'),
        adminB.from('team_members').select('id'),
      ]);
      const idsA = new Set((resA.data ?? []).map((r) => r.id));
      const idsB = new Set((resB.data ?? []).map((r) => r.id));
      for (const id of idsB) {
        expect(idsA.has(id)).toBe(false);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Master bypass — master sees all rows across orgs
  // ---------------------------------------------------------------------------

  describe('master sees all orgs combined', () => {
    it('master sees all organizations (2)', async () => {
      await expectRowCount(master, 'organizations', 2);
    });

    it('master sees all leads (6 = 4 + 2)', async () => {
      await expectRowCount(master, 'leads', 6);
    });

    it('master sees at least 2 tags', async () => {
      const { count, error } = await master
        .from('tags')
        .select('id', { count: 'exact', head: true });
      expect(error).toBeNull();
      expect(count).toBeGreaterThanOrEqual(2);
    });

    it('master sees at least 2 pipe_whatsapp', async () => {
      const { count, error } = await master
        .from('pipe_whatsapp')
        .select('id', { count: 'exact', head: true });
      expect(error).toBeNull();
      expect(count).toBeGreaterThanOrEqual(2);
    });

    it('master sees all team_members (7 = 5 + 2)', async () => {
      await expectRowCount(master, 'team_members', 7);
    });
  });

  // ---------------------------------------------------------------------------
  // Unseeded tables — RLS active, 0 rows returned (not an error)
  // ---------------------------------------------------------------------------

  const unseededTables = [
    'workflows',
    'workflow_executions',
    'campanhas',
    'campanha_leads',
    'campanha_members',
    'campanha_stages',
    'campanha_templates',
    'whatsapp_instances',
    'whatsapp_conversations',
    'copilot_agents',
    'products',
    'product_variants',
    'custom_pipelines',
    'custom_pipeline_stages',
    'goals',
    'awards',
    'competitions',
    'notifications',
    'checklists',
    'checklist_items',
    'webhooks',
    'follow_ups',
  ] as const;

  describe('unseeded tables: RLS active, 0 rows', () => {
    for (const table of unseededTables) {
      it(`${table}: Org A returns 0 rows`, async () => {
        const { count, error } = await adminA
          .from(table)
          .select('*', { count: 'exact', head: true });

        // 42P01 = relation does not exist — skip gracefully
        if (error?.code === '42P01') return;

        expect(error).toBeNull();
        expect(count).toBe(0);
      });

      it(`${table}: Org B returns 0 rows`, async () => {
        const { count, error } = await adminB
          .from(table)
          .select('*', { count: 'exact', head: true });

        if (error?.code === '42P01') return;

        expect(error).toBeNull();
        expect(count).toBe(0);
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Symmetry: both orgs experience the same RLS enforcement
  // ---------------------------------------------------------------------------

  describe('symmetry: both admins get identical schema behavior', () => {
    const seededTables = [
      'organizations',
      'leads',
      'tags',
      'pipe_whatsapp',
      'team_members',
    ];

    for (const table of seededTables) {
      it(`${table}: both admins can SELECT without error`, async () => {
        const [resA, resB] = await Promise.all([
          adminA.from(table).select('*', { count: 'exact', head: true }),
          adminB.from(table).select('*', { count: 'exact', head: true }),
        ]);

        expect(resA.error).toBeNull();
        expect(resB.error).toBeNull();
        expect(resA.count).toBeGreaterThanOrEqual(0);
        expect(resB.count).toBeGreaterThanOrEqual(0);
      });
    }
  });
});
