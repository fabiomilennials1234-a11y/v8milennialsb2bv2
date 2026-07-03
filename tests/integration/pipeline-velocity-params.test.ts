// @vitest-environment node
/**
 * Integration tests — get_pipeline_velocity RPC (SP-0 fix #12).
 *
 * Locks the three fixes in 20261202000300_fix_pipeline_velocity_params.sql:
 *   (a) p_pipeline_type ACTUALLY filters the pipe (was ignored — always 'propostas').
 *       Passing a different slug must change the result (not a no-op); NULL falls
 *       back to 'propostas' for backward compat.
 *   (b) win_rate numerator (won_deals) and denominator (all_deals) share the SAME
 *       [start,end] window. An out-of-window (after end) 'perdido' must NOT inflate
 *       total_closed / deflate win_rate.
 *   (c) avg_deal_value uses sale_value as-is (NUMERIC(12,2) reais) — NO /100.
 *
 * The RPC derives org from auth.uid() (no p_org_id param), so we create a dedicated
 * auth user + team_member in a fresh fixture org and call the RPC as that user.
 *
 * Prerequisites: local `supabase start` + migrations, OR remote project via
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (+ anon) envs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient, createAuthenticatedClient } from './rls-helpers';

const shouldSkip =
  !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

const ORG = 'ffffffff-0000-4000-a000-00000000c001';
const PIPE_PROPOSTAS = 'ffffffff-0000-4000-a000-0000000000c1';
const PIPE_WHATSAPP = 'ffffffff-0000-4000-a000-0000000000c2';
const TEST_EMAIL = `velocity-fixture-${Date.now()}@test.local`;
const TEST_PASSWORD = 'VelocityFix123!';

const svc: SupabaseClient = createServiceClient();
let userClient: SupabaseClient;
let testUserId: string;
let leadSeq = 0;

/** Distinct created_at window per test → absolute counts per test.
 *  `after` is always > end for the months used here (2–4). */
function win(monthIdx: number) {
  const m = String(monthIdx).padStart(2, '0');
  return {
    start: `2033-${m}-01T00:00:00Z`,
    end: `2033-${m}-28T23:59:59Z`,
    inside: `2033-${m}-10T12:00:00Z`,
    after: '2033-12-15T12:00:00Z', // beyond any month-2..4 window end
  };
}

async function seedLead(): Promise<string> {
  leadSeq += 1;
  const { data, error } = await svc
    .from('leads')
    .insert({
      organization_id: ORG,
      name: `Velocity Fixture ${leadSeq}`,
      phone: `+5599913${String(leadSeq).padStart(6, '0')}`,
    })
    .select('id')
    .single();
  if (error) throw new Error(`seedLead failed: ${error.message}`);
  return data.id as string;
}

async function seedEntry(
  pipelineId: string,
  stageKey: 'vendido' | 'perdido',
  createdAt: string,
  saleValue?: number,
) {
  const leadId = await seedLead();
  const { error } = await svc.from('pipeline_entries').insert({
    organization_id: ORG,
    pipeline_id: pipelineId,
    lead_id: leadId,
    stage_key: stageKey,
    created_at: createdAt,
    metadata: saleValue !== undefined ? { sale_value: saleValue } : {},
  });
  if (error) throw new Error(`seedEntry failed: ${error.message}`);
}

interface Velocity {
  num_won: number;
  total_closed: number;
  win_rate: number;
  avg_deal_value: number;
}

async function velocity(
  pipelineType: string | null,
  start: string,
  end: string,
): Promise<Velocity> {
  const { data, error } = await userClient.rpc('get_pipeline_velocity', {
    p_pipeline_type: pipelineType,
    p_start_date: start,
    p_end_date: end,
  });
  if (error) throw new Error(`rpc failed: ${error.message}`);
  return data as Velocity;
}

describe.skipIf(shouldSkip)('get_pipeline_velocity RPC — SP-0 fix #12', () => {
  beforeAll(async () => {
    // Fresh org
    const { error: orgErr } = await svc
      .from('organizations')
      .upsert({ id: ORG, name: 'Velocity Test Org', slug: 'velocity-test' }, { onConflict: 'id' });
    if (orgErr) throw new Error(`org seed failed: ${orgErr.message}`);

    // Wipe any prior fixture data
    for (const table of ['pipeline_entries', 'leads']) {
      await svc.from(table).delete().eq('organization_id', ORG);
    }
    await svc.from('team_members').delete().eq('organization_id', ORG);

    // Two system pipelines: only the slug differs so the p_pipeline_type filter is the
    // sole variable between them.
    for (const [id, slug] of [
      [PIPE_PROPOSTAS, 'propostas'],
      [PIPE_WHATSAPP, 'whatsapp'],
    ]) {
      const { error } = await svc.from('pipelines').upsert(
        { id, organization_id: ORG, name: `Fixture ${slug}`, slug, type: 'system' },
        { onConflict: 'id' },
      );
      if (error) throw new Error(`pipeline seed failed: ${error.message}`);
    }

    // Dedicated auth user → sole team_member → get_pipeline_velocity resolves org = ORG.
    const { data: authUser, error: authErr } = await svc.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (authErr) throw new Error(`createUser failed: ${authErr.message}`);
    testUserId = authUser.user.id;

    const { error: tmErr } = await svc.from('team_members').insert({
      user_id: testUserId,
      organization_id: ORG,
      name: 'Velocity Fixture User',
      role: 'member',
      is_active: false, // dodge seat-limit billing trigger; RPC only needs the mapping row
    });
    if (tmErr) throw new Error(`team_member seed failed: ${tmErr.message}`);

    userClient = await createAuthenticatedClient(TEST_EMAIL, TEST_PASSWORD);
  }, 30_000);

  afterAll(async () => {
    for (const table of ['pipeline_entries', 'leads', 'pipelines', 'team_members']) {
      await svc.from(table).delete().eq('organization_id', ORG);
    }
    await svc.from('organizations').delete().eq('id', ORG);
    if (testUserId) await svc.auth.admin.deleteUser(testUserId);
  });

  it('(a) p_pipeline_type filters the pipe — different slug yields a different result (not a no-op)', async () => {
    const w = win(2);
    // propostas: 3 vendido + 1 perdido  → num_won 3, total 4, win_rate 75
    await seedEntry(PIPE_PROPOSTAS, 'vendido', w.inside);
    await seedEntry(PIPE_PROPOSTAS, 'vendido', w.inside);
    await seedEntry(PIPE_PROPOSTAS, 'vendido', w.inside);
    await seedEntry(PIPE_PROPOSTAS, 'perdido', w.inside);
    // whatsapp: 1 vendido + 1 perdido    → num_won 1, total 2, win_rate 50
    await seedEntry(PIPE_WHATSAPP, 'vendido', w.inside);
    await seedEntry(PIPE_WHATSAPP, 'perdido', w.inside);

    const propostas = await velocity('propostas', w.start, w.end);
    const whatsapp = await velocity('whatsapp', w.start, w.end);

    expect(propostas).toMatchObject({ num_won: 3, total_closed: 4, win_rate: 75 });
    expect(whatsapp).toMatchObject({ num_won: 1, total_closed: 2, win_rate: 50 });

    // The core anti-regression: pre-fix both calls returned the propostas numbers.
    expect(whatsapp.num_won).not.toBe(propostas.num_won);
    expect(whatsapp.total_closed).not.toBe(propostas.total_closed);
    expect(whatsapp.win_rate).not.toBe(propostas.win_rate);

    // NULL p_pipeline_type falls back to 'propostas' (backward compat).
    const fallback = await velocity(null, w.start, w.end);
    expect(fallback).toMatchObject({ num_won: 3, total_closed: 4, win_rate: 75 });
  });

  it('(b) win_rate numerator and denominator share the same [start,end] window', async () => {
    const w = win(3);
    // Inside the window: 2 vendido, 0 perdido → win_rate must be 100, total_closed 2.
    await seedEntry(PIPE_PROPOSTAS, 'vendido', w.inside);
    await seedEntry(PIPE_PROPOSTAS, 'vendido', w.inside);
    // After the window end (Dec): 1 perdido + 1 vendido. Pre-fix, all_deals ignored
    // p_end_date and would count the perdido (total=3 → win_rate 66.7). The vendido
    // is always excluded from the numerator by end-window. Fixed: both excluded.
    await seedEntry(PIPE_PROPOSTAS, 'perdido', w.after);
    await seedEntry(PIPE_PROPOSTAS, 'vendido', w.after);

    const res = await velocity('propostas', w.start, w.end);

    expect(res.total_closed).toBe(2); // out-of-window perdido excluded from denominator
    expect(res.num_won).toBe(2);
    expect(res.win_rate).toBe(100); // 2/2, not 2/3 = 66.7
  });

  it('(c) avg_deal_value uses sale_value as-is (reais, NUMERIC(12,2)) — no /100', async () => {
    const w = win(4);
    await seedEntry(PIPE_PROPOSTAS, 'vendido', w.inside, 1000);
    await seedEntry(PIPE_PROPOSTAS, 'vendido', w.inside, 2000);

    const res = await velocity('propostas', w.start, w.end);

    expect(res.avg_deal_value).toBe(1500); // (1000+2000)/2 — would be 15 if divided by 100
  });
});
