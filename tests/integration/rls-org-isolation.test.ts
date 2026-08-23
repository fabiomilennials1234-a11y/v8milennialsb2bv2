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
import {
  TEST_ORG_ID,
  TEST_ORG_B_ID,
  TEST_ORG_A_LEAD_IDS,
  TEST_LEAD_ORGB_1_ID,
  TEST_LEAD_ORGB_2_ID,
} from './setup';
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
    // ⚠ CONTAGEM EXATA NÃO SOBREVIVE NUM BANCO COMPARTILHADO (SCRUM-362/426).
    // Este par pedia 4 e 2, e recebeu 7 e 2: dois leads vieram do seed §12
    // (cenário "Lead ≠ Negócio", que mora na Org A de propósito) e um veio de
    // uma suíte vizinha ainda em curso. A afirmação que importa é a fronteira:
    // o admin vê TODO o seed da própria org e NADA da outra.
    it('Org A admin vê todo o seed da Org A e nada de fora', async () => {
      const { data, error } = await adminA.from('leads').select('id, organization_id');
      expect(error).toBeNull();
      const ids = new Set((data ?? []).map((r) => r.id));
      for (const seeded of TEST_ORG_A_LEAD_IDS) expect(ids.has(seeded)).toBe(true);
      for (const row of data ?? []) expect(row.organization_id).toBe(TEST_ORG_ID);
    });

    it('Org B admin vê todo o seed da Org B e nada de fora', async () => {
      const { data, error } = await adminB.from('leads').select('id, organization_id');
      expect(error).toBeNull();
      const ids = new Set((data ?? []).map((r) => r.id));
      expect(ids.has(TEST_LEAD_ORGB_1_ID)).toBe(true);
      expect(ids.has(TEST_LEAD_ORGB_2_ID)).toBe(true);
      for (const row of data ?? []) expect(row.organization_id).toBe(TEST_ORG_B_ID);
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

  describe('tags', () => {
    it('Org A admin sees only own org tags (>= 1)', async () => {
      const { data, error } = await adminA.from('tags').select('organization_id');
      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(1);
      // Every tag visible must belong to Org A
      for (const row of data!) {
        expect(row.organization_id).toBe('00000000-0000-0000-0000-000000000001');
      }
    });

    it('Org B admin sees only own org tags (>= 1)', async () => {
      const { data, error } = await adminB.from('tags').select('organization_id');
      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(1);
      for (const row of data!) {
        expect(row.organization_id).toBe('00000000-0000-0000-0000-000000000002');
      }
    });
  });

  describe('pipe_whatsapp', () => {
    it('Org A admin sees exactly 1 pipe_whatsapp', async () => {
      await expectRowCount(adminA, 'pipe_whatsapp', 1);
    });

    it('Org B admin sees exactly 1 pipe_whatsapp', async () => {
      await expectRowCount(adminB, 'pipe_whatsapp', 1);
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

    it('master vê o seed das DUAS orgs (a contagem exata não é estável)', async () => {
      const { data, error } = await master.from('leads').select('id');
      expect(error).toBeNull();
      const ids = new Set((data ?? []).map((r) => r.id));
      for (const seeded of TEST_ORG_A_LEAD_IDS) expect(ids.has(seeded)).toBe(true);
      expect(ids.has(TEST_LEAD_ORGB_1_ID)).toBe(true);
      expect(ids.has(TEST_LEAD_ORGB_2_ID)).toBe(true);
    });

    it('master sees tags from both orgs', async () => {
      const { data, error } = await master.from('tags').select('organization_id');
      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(2);
      const orgs = new Set(data!.map(r => r.organization_id));
      expect(orgs.has('00000000-0000-0000-0000-000000000001')).toBe(true);
      expect(orgs.has('00000000-0000-0000-0000-000000000002')).toBe(true);
    });

    it('master sees all pipe_whatsapp (2 = 1 + 1)', async () => {
      await expectRowCount(master, 'pipe_whatsapp', 2);
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

  // ⚠ ESTE BLOCO PEDIA `count === 0` E ERA UMA ARMADILHA (SCRUM-426).
  //
  // "Tabela não semeada" não é propriedade do banco, é uma suposição sobre o que
  // as OUTRAS suítes fizeram — e o Vitest roda os arquivos em paralelo contra o
  // MESMO Postgres. Quatro vermelhos vieram daí: `workflows` com 2 linhas,
  // `workflow_executions` com 16, `custom_pipelines` e `custom_pipeline_stages`
  // com 1 cada, todas criadas por suítes vizinhas que ainda não tinham chegado
  // no `afterAll`. O vermelho aparecia e sumia conforme a ordem do agendador,
  // que é a pior espécie: mancha de leopardo em portão de segurança.
  //
  // O que esta suíte mede é ISOLAMENTO, e isolamento não depende de a tabela
  // estar vazia: o admin da Org A pode ver linha da Org A, e NUNCA linha da Org
  // B. É isso que passa a ser afirmado — e é mais forte, porque a versão antiga
  // passava trivialmente quando a tabela estava vazia por acaso.
  describe('unseeded tables: RLS active, nada atravessa a fronteira', () => {
    for (const table of unseededTables) {
      it(`${table}: Org A só enxerga linha da Org A`, async () => {
        const { data, error } = await adminA
          .from(table)
          .select('organization_id');

        // 42P01 = relation does not exist — skip gracefully
        if (error?.code === '42P01') return;
        // 42703 = a tabela existe mas não é escopada por org (não se aplica)
        if (error?.code === '42703') return;

        expect(error).toBeNull();
        const foreign = (data ?? []).filter(
          (r: { organization_id: string | null }) => r.organization_id !== TEST_ORG_ID,
        );
        expect(foreign).toEqual([]);
      });

      it(`${table}: Org B só enxerga linha da Org B`, async () => {
        const { data, error } = await adminB
          .from(table)
          .select('organization_id');

        if (error?.code === '42P01') return;
        if (error?.code === '42703') return;

        expect(error).toBeNull();
        const foreign = (data ?? []).filter(
          (r: { organization_id: string | null }) => r.organization_id !== TEST_ORG_B_ID,
        );
        expect(foreign).toEqual([]);
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
