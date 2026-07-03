// @vitest-environment node
/**
 * Integration tests — get_analytics_pipeline_metrics RPC (SP-0 fix #6).
 *
 * Locks the "proposta as a real funnel stage" fixes in
 * 20261202000000_fix_pipeline_funnel_proposta_conversion.sql. Before the fix,
 * four conversion sites were broken because there was NO count of leads that
 * reached the propostas pipe:
 *
 *   stage_analysis:
 *     - 'Reunião → Proposta' = attended / attended  → always 100% (numer == denom)
 *     - 'Proposta → Venda'   = won / attended       → wrong denominator (mislabeled)
 *   conversion_trends (monthly):
 *     - 'Reunião → Proposta' = meeting_cnt / meeting_cnt → always 100%
 *     - 'Proposta → Venda'   = won_cnt / meeting_cnt     → wrong denominator
 *
 * The fix adds proposta_leads/proposta_count (CTE) + monthly_proposta so the
 * transitions read proposta/attended and won/proposta respectively.
 *
 * The RPC takes p_org_id explicitly and assert_org_access() passes for
 * service_role, so tests call it directly with the service client. The pipe_*
 * relations are compat VIEWS over pipeline_entries — we seed pipeline_entries
 * (stage_key = the pipe status) directly, exactly like pipeline-velocity-params.
 *
 * Prerequisites: local `supabase start` + migrations, OR a remote project via
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY envs.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from './rls-helpers';

const shouldSkip =
  !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

const ORG = 'ffffffff-0000-4000-a000-00000000e001';
const PIPE_WHATSAPP = 'ffffffff-0000-4000-a000-0000000000e1';
const PIPE_CONFIRMACAO = 'ffffffff-0000-4000-a000-0000000000e2';
const PIPE_PROPOSTAS = 'ffffffff-0000-4000-a000-0000000000e3';

const svc: SupabaseClient = createServiceClient();
let leadSeq = 0;

interface Transition {
  transition_name: string;
  conversion_pct: number;
  lost_count: number;
  primary_loss_status: string;
}
interface Trend {
  transition_name: string;
  months: { month_label: string; rate: number }[];
}

/** Deterministic future window → absolute cohort counts, run-time independent. */
function futureWindow(monthIdx: number) {
  const m = String(monthIdx).padStart(2, '0');
  return {
    start: `2033-${m}-01`,
    end: `2033-${m}-28`,
    inside: `2033-${m}-10T12:00:00Z`,
  };
}

/** Current-month window (for the now()-relative conversion_trends series). */
function currentMonthWindow() {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return {
    start: first.toISOString().slice(0, 10),
    end: now.toISOString().slice(0, 10),
  };
}

async function wipe() {
  for (const table of ['pipeline_entries', 'leads']) {
    await svc.from(table).delete().eq('organization_id', ORG);
  }
}

async function seedLead(createdAt?: string): Promise<string> {
  leadSeq += 1;
  const { data, error } = await svc
    .from('leads')
    .insert({
      organization_id: ORG,
      name: `Proposta Conv Fixture ${leadSeq}`,
      phone: `+5599914${String(leadSeq).padStart(6, '0')}`,
      ...(createdAt ? { created_at: createdAt } : {}),
    })
    .select('id')
    .single();
  if (error) throw new Error(`seedLead failed: ${error.message}`);
  return data.id as string;
}

/** Insert one pipe entry (compat views read stage_key as `status`). */
async function seedEntry(
  pipelineId: string,
  leadId: string,
  stageKey: string,
  createdAt?: string,
) {
  const { error } = await svc.from('pipeline_entries').insert({
    organization_id: ORG,
    pipeline_id: pipelineId,
    lead_id: leadId,
    stage_key: stageKey,
    ...(createdAt ? { created_at: createdAt, updated_at: createdAt } : {}),
  });
  if (error) throw new Error(`seedEntry failed: ${error.message}`);
}

async function callRpc(start: string, end: string) {
  const { data, error } = await svc.rpc('get_analytics_pipeline_metrics', {
    p_org_id: ORG,
    p_start_date: start,
    p_end_date: end,
    p_pipeline_type: null,
  });
  if (error) throw new Error(`rpc failed: ${error.message}`);
  return data as {
    stage_analysis: Transition[];
    conversion_trends: Trend[];
  };
}

describe.skipIf(shouldSkip)('get_analytics_pipeline_metrics RPC — SP-0 fix #6', () => {
  beforeAll(async () => {
    const { error: orgErr } = await svc
      .from('organizations')
      .upsert(
        { id: ORG, name: 'Proposta Conversion Test Org', slug: 'proposta-conv-test' },
        { onConflict: 'id' },
      );
    if (orgErr) throw new Error(`org seed failed: ${orgErr.message}`);

    for (const [id, slug] of [
      [PIPE_WHATSAPP, 'whatsapp'],
      [PIPE_CONFIRMACAO, 'confirmacao'],
      [PIPE_PROPOSTAS, 'propostas'],
    ]) {
      const { error } = await svc.from('pipelines').upsert(
        { id, organization_id: ORG, name: `Fixture ${slug}`, slug, type: 'system' },
        { onConflict: 'id' },
      );
      if (error) throw new Error(`pipeline seed failed: ${error.message}`);
    }
  });

  beforeEach(wipe);

  afterAll(async () => {
    await wipe();
    await svc.from('pipelines').delete().eq('organization_id', ORG);
    await svc.from('organizations').delete().eq('id', ORG);
  });

  it('stage_analysis: Reunião→Proposta reflects proposta/attended (< 100), Proposta→Venda reflects won/proposta', async () => {
    const w = futureWindow(2);
    // 6 cohort leads. Journey depth decreases per stage so every denominator > numerator.
    const leads: string[] = [];
    for (let i = 0; i < 6; i++) leads.push(await seedLead(w.inside));

    // Qualificação (WhatsApp): L1..L5  → qualified = 5
    for (const id of leads.slice(0, 5)) await seedEntry(PIPE_WHATSAPP, id, 'novo_lead', w.inside);
    // Reunião (compareceu): L1..L4      → attended = 4
    for (const id of leads.slice(0, 4)) await seedEntry(PIPE_CONFIRMACAO, id, 'compareceu', w.inside);
    // Proposta reached: L1 (vendido) + L2 (enviada) → proposta = 2, won = 1
    await seedEntry(PIPE_PROPOSTAS, leads[0], 'vendido', w.inside);
    await seedEntry(PIPE_PROPOSTAS, leads[1], 'enviada', w.inside);

    const res = await callRpc(w.start, w.end);
    const byName = (n: string) =>
      res.stage_analysis.find((t) => t.transition_name === n) as Transition;

    const reuniaoProposta = byName('Reunião → Proposta');
    const propostaVenda = byName('Proposta → Venda');

    // Headline fix: proposta(2) / attended(4) = 50 — was attended/attended = 100 (trivial).
    expect(reuniaoProposta.conversion_pct).toBe(50);
    expect(reuniaoProposta.conversion_pct).toBeLessThan(100);

    // Headline fix: won(1) / proposta(2) = 50 — was won/attended = 1/4 = 25 (mislabeled denom).
    expect(propostaVenda.conversion_pct).toBe(50);

    // Sanity on the untouched upstream transitions (both denom > numer).
    expect(byName('Lead → Qualificação').conversion_pct).toBeCloseTo(83.3, 1); // 5/6
    expect(byName('Qualificação → Reunião').conversion_pct).toBe(80); // 4/5

    // Anti-regression guard: with strictly-narrowing funnel (numer < denom at every
    // step) NO transition may report a trivial 100%.
    for (const t of res.stage_analysis) {
      expect(t.conversion_pct).toBeLessThan(100);
    }
  });

  it('conversion_trends: monthly Reunião→Proposta uses proposta/meeting (never trivial 100), Proposta→Venda uses won/proposta', async () => {
    // now()-dated rows land in the current month bucket of months_series.
    const now = new Date().toISOString();
    const leads: string[] = [];
    for (let i = 0; i < 4; i++) leads.push(await seedLead(now));

    // qualified(4), meeting(4)
    for (const id of leads) await seedEntry(PIPE_WHATSAPP, id, 'novo_lead', now);
    for (const id of leads) await seedEntry(PIPE_CONFIRMACAO, id, 'compareceu', now);
    // proposta(2): L1 vendido (won=1), L2 enviada
    await seedEntry(PIPE_PROPOSTAS, leads[0], 'vendido', now);
    await seedEntry(PIPE_PROPOSTAS, leads[1], 'enviada', now);

    const w = currentMonthWindow();
    const res = await callRpc(w.start, w.end);
    const trend = (n: string) =>
      res.conversion_trends.find((t) => t.transition_name === n) as Trend;

    const rpRates = trend('Reunião → Proposta').months.map((m) => m.rate);
    const pvRates = trend('Proposta → Venda').months.map((m) => m.rate);

    // Fix: proposta(2)/meeting(4) = 50 shows up; the buggy meeting/meeting = 100 never does.
    expect(rpRates).toContain(50);
    expect(rpRates).not.toContain(100);

    // Fix: won(1)/proposta(2) = 50 shows up; the buggy won/meeting = 1/4 = 25 does not.
    expect(pvRates).toContain(50);
    expect(pvRates).not.toContain(25);
  });
});
