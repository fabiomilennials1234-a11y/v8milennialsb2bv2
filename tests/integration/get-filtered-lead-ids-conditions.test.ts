// @vitest-environment node
/**
 * Integration tests — Disparo Phase 1 richer audience conditions across the
 * THREE lead_id resolvers (system funnels, custom funnels, carteira):
 *
 *   1. get_filtered_lead_ids       (system funnels, extended 8-arg)
 *   2. get_custom_filtered_lead_ids (custom funnels)
 *   3. get_carteira_lead_ids        (post-sale portfolio)
 *
 * Each resolver applies the SHARED CONDITION SET on the LEADS table:
 *   qualification_tier / pre_qualification_tier / origin (+ tags / search).
 *
 * Coverage here (complements the existing get-filtered-lead-ids.test.ts which
 * already proves search/responsible/tags/stage + org isolation on the SYSTEM
 * resolver):
 *   - A qualification_tier filter NARROWS the system resolver.
 *   - get_custom_filtered_lead_ids resolves a custom pipeline + a tier filter
 *     narrows, AND ORG ISOLATION (org B sees nothing of org A).
 *   - get_carteira_lead_ids resolves active carteira clients + a segment +
 *     tier filter narrows, AND ORG ISOLATION (org B sees nothing of org A).
 *
 * Self-seeds via the service client, then calls the RPCs as authenticated
 * org-A / org-B admins so RLS + the SECURITY DEFINER tenancy helper are
 * exercised for real. Mirrors get-filtered-lead-ids.test.ts.
 *
 * Prerequisites:
 *   1. `supabase start` running
 *   2. Seed applied (`supabase db reset`)
 *   3. Migrations 20261123000000/01/02 applied
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
import { getOrgAAdmin, getOrgBAdmin, clearClients } from './rls-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

const shouldSkip =
  !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

// System pipeline fixtures (slug 'whatsapp').
// ⚠ O funil de sistema é o QUE JÁ EXISTE na org (resolvido em `beforeAll` por
// `getSystemPipelineId`), não um segundo criado aqui. `pipelines` tem
// UNIQUE (organization_id, slug): o upsert antigo, com `onConflict: 'id'` e id
// próprio, batia no índice errado, devolvia 23505 sem ninguém checar, e o funil
// nunca nascia — a RPC então respondia com a linha do seed e a asserção lia
// `Set{1}` contra `Set{2}`. Ver SCRUM-362 e o comentário de getSystemPipelineId.
let SYS_PIPELINE_A_ID: string;
let SYS_PIPELINE_B_ID: string;
const SYS_STAGE = 'novo';

// Custom pipeline fixtures.
const CUSTOM_PIPELINE_A_ID = '00000000-0000-0000-0000-0000000723c1';
const CUSTOM_PIPELINE_B_ID = '00000000-0000-0000-0000-0000000723c2';
const CUSTOM_STAGE_A_ID = '00000000-0000-0000-0000-0000000723d1';
const CUSTOM_STAGE_B_ID = '00000000-0000-0000-0000-0000000723d2';

// Carteira fixtures.
const UPSELL_A_ALPHA_ID = '00000000-0000-0000-0000-0000000723e1';
const UPSELL_A_BETA_ID = '00000000-0000-0000-0000-0000000723e2';
const UPSELL_B_ID = '00000000-0000-0000-0000-0000000723e3';

describe.skipIf(shouldSkip)('Disparo P1 audience conditions (3 resolvers)', () => {
  let adminA: SupabaseClient;
  let adminB: SupabaseClient;

  beforeAll(async () => {
    [adminA, adminB] = await Promise.all([getOrgAAdmin(), getOrgBAdmin()]);

    // ── Lead conditions ──────────────────────────────────────────────────
    // Alpha: tier diamante, origin meta_ads. Beta/Gamma: tier ouro, origin site.
    // OrgB-1: tier diamante (must stay invisible to org A).
    await supabase
      .from('leads')
      .update({ qualification_tier: 'diamante', origin: 'meta_ads' })
      .eq('id', TEST_LEAD_ALPHA_ID);
    await supabase
      .from('leads')
      .update({ qualification_tier: 'ouro', origin: 'site' })
      .in('id', [TEST_LEAD_BETA_ID, TEST_LEAD_GAMMA_ID]);
    await supabase
      .from('leads')
      .update({ qualification_tier: 'diamante', origin: 'meta_ads' })
      .eq('id', TEST_LEAD_ORGB_1_ID);

    // ── System funnels ───────────────────────────────────────────────────
    [SYS_PIPELINE_A_ID, SYS_PIPELINE_B_ID] = await Promise.all([
      getSystemPipelineId(TEST_ORG_ID, 'whatsapp'),
      getSystemPipelineId(TEST_ORG_B_ID, 'whatsapp'),
    ]);
    await supabase
      .from('pipeline_entries')
      .delete()
      .in('pipeline_id', [SYS_PIPELINE_A_ID, SYS_PIPELINE_B_ID]);
    await supabase.from('pipeline_entries').insert([
      { organization_id: TEST_ORG_ID, pipeline_id: SYS_PIPELINE_A_ID, lead_id: TEST_LEAD_ALPHA_ID, stage_key: SYS_STAGE },
      { organization_id: TEST_ORG_ID, pipeline_id: SYS_PIPELINE_A_ID, lead_id: TEST_LEAD_BETA_ID, stage_key: SYS_STAGE },
      { organization_id: TEST_ORG_ID, pipeline_id: SYS_PIPELINE_A_ID, lead_id: TEST_LEAD_GAMMA_ID, stage_key: SYS_STAGE },
      { organization_id: TEST_ORG_B_ID, pipeline_id: SYS_PIPELINE_B_ID, lead_id: TEST_LEAD_ORGB_1_ID, stage_key: SYS_STAGE },
    ]);

    // ── Custom funnels ───────────────────────────────────────────────────
    await supabase.from('custom_pipelines').upsert(
      [
        { id: CUSTOM_PIPELINE_A_ID, organization_id: TEST_ORG_ID, name: 'Custom A', slug: 'custom-723-a' },
        { id: CUSTOM_PIPELINE_B_ID, organization_id: TEST_ORG_B_ID, name: 'Custom B', slug: 'custom-723-b' },
      ],
      { onConflict: 'id' },
    );
    await supabase.from('custom_pipeline_stages').upsert(
      [
        { id: CUSTOM_STAGE_A_ID, organization_id: TEST_ORG_ID, pipeline_id: CUSTOM_PIPELINE_A_ID, stage_key: 'inicio', name: 'Inicio' },
        { id: CUSTOM_STAGE_B_ID, organization_id: TEST_ORG_B_ID, pipeline_id: CUSTOM_PIPELINE_B_ID, stage_key: 'inicio', name: 'Inicio' },
      ],
      { onConflict: 'id' },
    );
    await supabase
      .from('custom_pipe_entries')
      .delete()
      .in('pipeline_id', [CUSTOM_PIPELINE_A_ID, CUSTOM_PIPELINE_B_ID]);
    await supabase.from('custom_pipe_entries').insert([
      { organization_id: TEST_ORG_ID, pipeline_id: CUSTOM_PIPELINE_A_ID, lead_id: TEST_LEAD_ALPHA_ID, stage_id: CUSTOM_STAGE_A_ID },
      { organization_id: TEST_ORG_ID, pipeline_id: CUSTOM_PIPELINE_A_ID, lead_id: TEST_LEAD_BETA_ID, stage_id: CUSTOM_STAGE_A_ID },
      { organization_id: TEST_ORG_B_ID, pipeline_id: CUSTOM_PIPELINE_B_ID, lead_id: TEST_LEAD_ORGB_1_ID, stage_id: CUSTOM_STAGE_B_ID },
    ]);

    // ── Carteira ─────────────────────────────────────────────────────────
    // Alpha: segment ouro. Beta: segment prata. OrgB-1: segment ouro (org B).
    await supabase
      .from('upsell_clients')
      .delete()
      .in('id', [UPSELL_A_ALPHA_ID, UPSELL_A_BETA_ID, UPSELL_B_ID]);
    await supabase.from('upsell_clients').insert([
      { id: UPSELL_A_ALPHA_ID, organization_id: TEST_ORG_ID, lead_id: TEST_LEAD_ALPHA_ID, name: 'Lead Alpha', segment: 'ouro', is_active: true },
      { id: UPSELL_A_BETA_ID, organization_id: TEST_ORG_ID, lead_id: TEST_LEAD_BETA_ID, name: 'Lead Beta', segment: 'prata', is_active: true },
      { id: UPSELL_B_ID, organization_id: TEST_ORG_B_ID, lead_id: TEST_LEAD_ORGB_1_ID, name: 'Lead OrgB', segment: 'ouro', is_active: true },
    ]);
  });

  afterAll(async () => {
    await supabase
      .from('upsell_clients')
      .delete()
      .in('id', [UPSELL_A_ALPHA_ID, UPSELL_A_BETA_ID, UPSELL_B_ID]);
    await supabase
      .from('custom_pipe_entries')
      .delete()
      .in('pipeline_id', [CUSTOM_PIPELINE_A_ID, CUSTOM_PIPELINE_B_ID]);
    await supabase
      .from('custom_pipeline_stages')
      .delete()
      .in('id', [CUSTOM_STAGE_A_ID, CUSTOM_STAGE_B_ID]);
    await supabase
      .from('custom_pipelines')
      .delete()
      .in('id', [CUSTOM_PIPELINE_A_ID, CUSTOM_PIPELINE_B_ID]);
    await restoreSeedWhatsappEntries();
    // O funil de sistema NÃO é apagado: ele é do seed, e outras suítes contam
    // com ele (`pipe_whatsapp` é view sobre ele).
    // Undo lead mutations.
    await supabase
      .from('leads')
      .update({ qualification_tier: null, pre_qualification_tier: null, origin: 'outro' })
      .in('id', [TEST_LEAD_ALPHA_ID, TEST_LEAD_BETA_ID, TEST_LEAD_GAMMA_ID, TEST_LEAD_ORGB_1_ID]);
    await clearClients();
  });

  // ── 1. SYSTEM resolver — tier condition narrows ─────────────────────────
  describe('get_filtered_lead_ids — shared conditions', () => {
    it('qualification_tier=[diamante] narrows to Alpha only', async () => {
      const { data, error } = await adminA.rpc('get_filtered_lead_ids', {
        p_pipeline_type: 'whatsapp',
        p_stage_key: null,
        p_search: null,
        p_responsible_id: null,
        p_tag_ids: null,
        p_qualification_tier: ['diamante'],
        p_pre_qualification_tier: null,
        p_origin: null,
      });
      expect(error).toBeNull();
      expect((data as string[]) ?? []).toEqual([TEST_LEAD_ALPHA_ID]);
    });

    it('origin=[site] narrows to Beta + Gamma', async () => {
      const { data, error } = await adminA.rpc('get_filtered_lead_ids', {
        p_pipeline_type: 'whatsapp',
        p_stage_key: null,
        p_search: null,
        p_responsible_id: null,
        p_tag_ids: null,
        p_qualification_tier: null,
        p_pre_qualification_tier: null,
        p_origin: ['site'],
      });
      expect(error).toBeNull();
      expect(new Set((data as string[]) ?? [])).toEqual(
        new Set([TEST_LEAD_BETA_ID, TEST_LEAD_GAMMA_ID]),
      );
    });

    it('null conditions = all three org-A leads (back-compat default)', async () => {
      const { data, error } = await adminA.rpc('get_filtered_lead_ids', {
        p_pipeline_type: 'whatsapp',
        p_stage_key: null,
        p_search: null,
        p_responsible_id: null,
        p_tag_ids: null,
        p_qualification_tier: null,
        p_pre_qualification_tier: null,
        p_origin: null,
      });
      expect(error).toBeNull();
      expect(new Set((data as string[]) ?? [])).toEqual(
        new Set([TEST_LEAD_ALPHA_ID, TEST_LEAD_BETA_ID, TEST_LEAD_GAMMA_ID]),
      );
    });
  });

  // ── 2. CUSTOM resolver — tier narrows + org isolation ───────────────────
  describe('get_custom_filtered_lead_ids', () => {
    it('resolves the whole custom pipeline (no condition)', async () => {
      const { data, error } = await adminA.rpc('get_custom_filtered_lead_ids', {
        p_pipeline_id: CUSTOM_PIPELINE_A_ID,
        p_stage_id: null,
        p_search: null,
        p_responsible_id: null,
        p_tag_ids: null,
        p_qualification_tier: null,
        p_pre_qualification_tier: null,
        p_origin: null,
      });
      expect(error).toBeNull();
      expect(new Set((data as string[]) ?? [])).toEqual(
        new Set([TEST_LEAD_ALPHA_ID, TEST_LEAD_BETA_ID]),
      );
    });

    it('qualification_tier=[diamante] narrows to Alpha', async () => {
      const { data, error } = await adminA.rpc('get_custom_filtered_lead_ids', {
        p_pipeline_id: CUSTOM_PIPELINE_A_ID,
        p_stage_id: null,
        p_search: null,
        p_responsible_id: null,
        p_tag_ids: null,
        p_qualification_tier: ['diamante'],
        p_pre_qualification_tier: null,
        p_origin: null,
      });
      expect(error).toBeNull();
      expect((data as string[]) ?? []).toEqual([TEST_LEAD_ALPHA_ID]);
    });

    it('ORG ISOLATION — org B caller gets nothing for org A custom pipeline', async () => {
      // Org B passes org A's custom pipeline id; tenancy is server-derived, so
      // it must resolve to zero rows.
      const { data, error } = await adminB.rpc('get_custom_filtered_lead_ids', {
        p_pipeline_id: CUSTOM_PIPELINE_A_ID,
        p_stage_id: null,
        p_search: null,
        p_responsible_id: null,
        p_tag_ids: null,
        p_qualification_tier: null,
        p_pre_qualification_tier: null,
        p_origin: null,
      });
      expect(error).toBeNull();
      expect((data as string[]) ?? []).toEqual([]);

      // And org B sees only its own pipeline's lead.
      const { data: ownData } = await adminB.rpc('get_custom_filtered_lead_ids', {
        p_pipeline_id: CUSTOM_PIPELINE_B_ID,
        p_stage_id: null,
        p_search: null,
        p_responsible_id: null,
        p_tag_ids: null,
        p_qualification_tier: null,
        p_pre_qualification_tier: null,
        p_origin: null,
      });
      expect((ownData as string[]) ?? []).toEqual([TEST_LEAD_ORGB_1_ID]);
    });
  });

  // ── 3. CARTEIRA resolver — segment + tier narrows + org isolation ───────
  describe('get_carteira_lead_ids', () => {
    it('resolves all active carteira leads (no condition)', async () => {
      const { data, error } = await adminA.rpc('get_carteira_lead_ids', {
        p_segments: null,
        p_search: null,
        p_tag_ids: null,
        p_qualification_tier: null,
        p_pre_qualification_tier: null,
        p_origin: null,
      });
      expect(error).toBeNull();
      expect(new Set((data as string[]) ?? [])).toEqual(
        new Set([TEST_LEAD_ALPHA_ID, TEST_LEAD_BETA_ID]),
      );
    });

    it('segments=[ouro] narrows to Alpha', async () => {
      const { data, error } = await adminA.rpc('get_carteira_lead_ids', {
        p_segments: ['ouro'],
        p_search: null,
        p_tag_ids: null,
        p_qualification_tier: null,
        p_pre_qualification_tier: null,
        p_origin: null,
      });
      expect(error).toBeNull();
      expect((data as string[]) ?? []).toEqual([TEST_LEAD_ALPHA_ID]);
    });

    it('qualification_tier=[ouro] narrows to Beta', async () => {
      const { data, error } = await adminA.rpc('get_carteira_lead_ids', {
        p_segments: null,
        p_search: null,
        p_tag_ids: null,
        p_qualification_tier: ['ouro'],
        p_pre_qualification_tier: null,
        p_origin: null,
      });
      expect(error).toBeNull();
      expect((data as string[]) ?? []).toEqual([TEST_LEAD_BETA_ID]);
    });

    it('ORG ISOLATION — org B sees only its own carteira; org A never sees it', async () => {
      const [resB, resA] = await Promise.all([
        adminB.rpc('get_carteira_lead_ids', {
          p_segments: null,
          p_search: null,
          p_tag_ids: null,
          p_qualification_tier: null,
          p_pre_qualification_tier: null,
          p_origin: null,
        }),
        adminA.rpc('get_carteira_lead_ids', {
          p_segments: null,
          p_search: null,
          p_tag_ids: null,
          p_qualification_tier: null,
          p_pre_qualification_tier: null,
          p_origin: null,
        }),
      ]);
      expect(resB.error).toBeNull();
      expect(resA.error).toBeNull();

      const idsB = (resB.data as string[]) ?? [];
      const idsA = (resA.data as string[]) ?? [];

      expect(idsB).toEqual([TEST_LEAD_ORGB_1_ID]);
      expect(idsA).not.toContain(TEST_LEAD_ORGB_1_ID);
      for (const id of idsB) expect(idsA).not.toContain(id);
    });
  });
});
