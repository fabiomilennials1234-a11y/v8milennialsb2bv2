// @vitest-environment node
/**
 * Integration tests — get_productivity_activity + _leads RPCs (Produtividade).
 *
 * Semantics locked in ADR-0013 / CONTEXT.md (Produtividade — Activity-in-Period):
 *   - Every count is keyed to the DATE OF THE ACTION ITSELF, never to the Lead's
 *     creation/entry date (the OPPOSITE of get_funnel_health's cohort-by-creation).
 *   - Novos leads        → leads.created_at in window.
 *   - Reuniões Marcadas  → meeting_events 'meeting_booked' by occurred_at.
 *   - Reuniões Realizadas→ meeting_events 'meeting_held' by meeting_date.
 *   - Vendido            → current 'vendido' entry on system 'propostas' pipe,
 *                          dated by durable lead_history move (closed_at fallback).
 *   - Attribution: Pré-vendas for meetings, Closer for sales, responsável for novos.
 *
 * Each test isolates itself by using a distinct WINDOW within a dedicated org.
 *
 * Prerequisites: local `supabase start` + migrations, OR remote project via
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY envs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabase } from './setup';

const shouldSkip =
  !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

const ORG = 'ffffffff-0000-4000-a000-00000000e001';
const ORG_B = 'ffffffff-0000-4000-a000-00000000e002';
const PIPELINE_PROPOSTAS_ID = 'ffffffff-0000-4000-a000-0000000000e1';
const PIPELINE_PROPOSTAS_B_ID = 'ffffffff-0000-4000-a000-0000000000e2';
const TM1 = 'ffffffff-0000-4000-a000-0000000000b1';
const TM2 = 'ffffffff-0000-4000-a000-0000000000b2';

let leadSeq = 0;

/** Distinct window per test → absolute counts per test. */
function win(monthIdx: number) {
  const m = String(monthIdx).padStart(2, '0');
  const pm = String(monthIdx - 1).padStart(2, '0');
  return {
    from: `2031-${m}-01T00:00:00Z`,
    to: `2031-${m}-28T23:59:59Z`,
    inside: `2031-${m}-10T12:00:00Z`,
    inside2: `2031-${m}-20T12:00:00Z`,
    before: `2031-${pm}-10T12:00:00Z`,
  };
}

interface LeadOverrides {
  organization_id?: string;
  created_at?: string;
  deleted_at?: string | null;
  responsible_id?: string | null;
  sdr_id?: string | null;
  sale_responsible_id?: string | null;
  closer_id?: string | null;
}

async function seedLead(overrides: LeadOverrides = {}): Promise<string> {
  leadSeq += 1;
  const { data, error } = await supabase
    .from('leads')
    .insert({
      organization_id: ORG,
      name: `Produtividade Fixture ${leadSeq}`,
      company: `Empresa ${leadSeq}`,
      phone: `+5599912${String(leadSeq).padStart(6, '0')}`,
      ...overrides,
    })
    .select('id')
    .single();
  if (error) throw new Error(`seedLead failed: ${error.message}`);
  return data.id as string;
}

async function seedMeeting(
  leadId: string,
  eventType: 'meeting_booked' | 'meeting_held',
  opts: { occurredAt?: string; meetingDate?: string; presale?: string | null; org?: string } = {},
) {
  const { error } = await supabase.from('meeting_events').insert({
    organization_id: opts.org ?? ORG,
    lead_id: leadId,
    event_type: eventType,
    occurred_at: opts.occurredAt ?? new Date().toISOString(),
    meeting_date: opts.meetingDate ?? null,
    pre_sale_responsible_id: opts.presale ?? null,
    source: 'integration-test',
  });
  if (error) throw new Error(`seedMeeting failed: ${error.message}`);
}

async function seedVendidoEntry(
  leadId: string,
  opts: { closedAt?: string | null; closerId?: string | null; pipelineId?: string; org?: string } = {},
) {
  const { error } = await supabase.from('pipeline_entries').insert({
    organization_id: opts.org ?? ORG,
    pipeline_id: opts.pipelineId ?? PIPELINE_PROPOSTAS_ID,
    lead_id: leadId,
    stage_key: 'vendido',
    closed_at: opts.closedAt ?? null,
    metadata: opts.closerId ? { closer_id: opts.closerId } : {},
  });
  if (error) throw new Error(`seedVendidoEntry failed: ${error.message}`);
}

/** Durable move-to-vendido row (automation path: action=stage_changed). */
async function seedVendidoHistory(leadId: string, createdAt: string, org = ORG) {
  const { error } = await supabase.from('lead_history').insert({
    organization_id: org,
    lead_id: leadId,
    action: 'stage_changed',
    description: 'Etapa alterada para "Vendido"',
    metadata: { to_stage: 'vendido', pipe_slug: 'propostas' },
    created_at: createdAt,
  });
  if (error) throw new Error(`seedVendidoHistory failed: ${error.message}`);
}

async function counts(from: string, to: string, seller?: string | null, org: string = ORG) {
  const { data, error } = await supabase.rpc('get_productivity_activity', {
    p_org_id: org,
    p_from: from,
    p_to: to,
    p_seller: seller ?? null,
  });
  if (error) throw new Error(`rpc counts failed: ${error.message}`);
  return data as {
    novos_leads: number;
    reunioes_marcadas: number;
    reunioes_realizadas: number;
    vendido: number;
  };
}

async function drill(
  type: string,
  from: string,
  to: string,
  seller?: string | null,
  org: string = ORG,
) {
  const { data, error } = await supabase.rpc('get_productivity_activity_leads', {
    p_org_id: org,
    p_from: from,
    p_to: to,
    p_count_type: type,
    p_seller: seller ?? null,
  });
  if (error) throw new Error(`rpc drill failed: ${error.message}`);
  return data as Array<{ lead_id: string; action_at: string; seller_id: string | null }>;
}

describe.skipIf(shouldSkip)('get_productivity_activity RPC', () => {
  beforeAll(async () => {
    for (const [id, name, slug] of [
      [ORG, 'Produtividade Test Org A', 'productivity-test-a'],
      [ORG_B, 'Produtividade Test Org B', 'productivity-test-b'],
    ]) {
      const { error } = await supabase
        .from('organizations')
        .upsert({ id, name, slug }, { onConflict: 'id' });
      if (error) throw new Error(`org seed failed: ${error.message}`);
    }
    for (const table of ['meeting_events', 'pipeline_entries', 'lead_history', 'leads']) {
      await supabase.from(table).delete().in('organization_id', [ORG, ORG_B]);
    }
    for (const [id, org] of [
      [PIPELINE_PROPOSTAS_ID, ORG],
      [PIPELINE_PROPOSTAS_B_ID, ORG_B],
    ]) {
      const { error } = await supabase.from('pipelines').upsert(
        { id, organization_id: org, name: 'Orçamentos (fixture)', slug: 'propostas', type: 'system' },
        { onConflict: 'id' },
      );
      if (error) throw new Error(`pipeline seed failed: ${error.message}`);
    }
    const { error: tmErr } = await supabase.from('team_members').upsert(
      [
        { id: TM1, organization_id: ORG, name: 'Vendedor Um', role: 'member', is_active: false },
        { id: TM2, organization_id: ORG, name: 'Vendedor Dois', role: 'member', is_active: false },
      ],
      { onConflict: 'id' },
    );
    if (tmErr) throw new Error(`team_members seed failed: ${tmErr.message}`);
  });

  afterAll(async () => {
    for (const table of [
      'meeting_events',
      'pipeline_entries',
      'lead_history',
      'leads',
      'pipelines',
      'team_members',
      'organizations',
    ]) {
      const col = table === 'organizations' ? 'id' : 'organization_id';
      await supabase.from(table).delete().in(col, [ORG, ORG_B]);
    }
  });

  it('ANTI-COHORT: lead created outside the window but with action inside is counted', async () => {
    const w = win(2);
    // Lead "born" before the window; meeting booked + held, and sold, all INSIDE.
    const lead = await seedLead({ created_at: w.before });
    await seedMeeting(lead, 'meeting_booked', { occurredAt: w.inside });
    await seedMeeting(lead, 'meeting_held', { meetingDate: w.inside2 });
    await seedVendidoEntry(lead, { closedAt: null });
    await seedVendidoHistory(lead, w.inside);

    const c = await counts(w.from, w.to);
    expect(c.novos_leads).toBe(0); // created before window → not a "new lead" here
    expect(c.reunioes_marcadas).toBe(1);
    expect(c.reunioes_realizadas).toBe(1);
    expect(c.vendido).toBe(1);
  });

  it('lead created inside with no action counts only as Novos leads', async () => {
    const w = win(3);
    await seedLead({ created_at: w.inside });
    await seedLead({ created_at: w.inside, deleted_at: w.inside }); // soft-deleted → out
    await seedLead({ created_at: w.before }); // out of window
    await seedLead({ created_at: w.inside, organization_id: ORG_B }); // other org

    const c = await counts(w.from, w.to);
    expect(c.novos_leads).toBe(1);
    expect(c.reunioes_marcadas).toBe(0);
    expect(c.reunioes_realizadas).toBe(0);
    expect(c.vendido).toBe(0);
  });

  it('reschedule (<=30d) does not double-count Marcadas — event model dedups', async () => {
    // Drive the real capture trigger on a confirmacao pipe (occurred_at = now()).
    const { error: pipeErr } = await supabase.from('pipelines').upsert(
      {
        id: 'ffffffff-0000-4000-a000-0000000000e3',
        organization_id: ORG,
        name: 'Confirmação (fixture)',
        slug: 'confirmacao',
        type: 'system',
      },
      { onConflict: 'id' },
    );
    if (pipeErr) throw new Error(pipeErr.message);

    const lead = await seedLead({ created_at: new Date().toISOString() });
    const d1 = '2031-06-10T10:00:00Z';
    const d2 = '2031-06-18T10:00:00Z'; // +8 days → reschedule, not a new booking

    const { data: entry, error: insErr } = await supabase
      .from('pipeline_entries')
      .insert({
        organization_id: ORG,
        pipeline_id: 'ffffffff-0000-4000-a000-0000000000e3',
        lead_id: lead,
        stage_key: 'agendado',
        metadata: { meeting_date: d1 },
      })
      .select('id')
      .single();
    if (insErr) throw new Error(insErr.message);

    await supabase
      .from('pipeline_entries')
      .update({ metadata: { meeting_date: d2 } })
      .eq('id', entry.id);

    const now = Date.now();
    const from = new Date(now - 86400_000).toISOString();
    const to = new Date(now + 86400_000).toISOString();
    const c = await counts(from, to);
    expect(c.reunioes_marcadas).toBe(1);

    await supabase.from('pipelines').delete().eq('id', 'ffffffff-0000-4000-a000-0000000000e3');
  });

  it('Comparecida is keyed by meeting_date, not occurred_at of the booking', async () => {
    const w = win(4);
    const lead = await seedLead({ created_at: w.before });
    // held event recorded (occurred_at) AFTER the window, but the meeting happened INSIDE
    await seedMeeting(lead, 'meeting_held', { occurredAt: '2031-12-01T00:00:00Z', meetingDate: w.inside });
    // a second held whose meeting_date is OUTSIDE → must not count
    const lead2 = await seedLead({ created_at: w.before });
    await seedMeeting(lead2, 'meeting_held', { occurredAt: w.inside, meetingDate: w.before });

    const c = await counts(w.from, w.to);
    expect(c.reunioes_realizadas).toBe(1);
  });

  it('Vendido is dated by the durable move (lead_history), closed_at as fallback', async () => {
    const w = win(5);
    // Sold via lead_history move INSIDE the window; entry.closed_at deliberately OUTSIDE
    const l1 = await seedLead({ created_at: w.before });
    await seedVendidoEntry(l1, { closedAt: '2031-12-31T00:00:00Z' });
    await seedVendidoHistory(l1, w.inside);
    // Sold with NO lead_history → falls back to closed_at INSIDE
    const l2 = await seedLead({ created_at: w.before });
    await seedVendidoEntry(l2, { closedAt: w.inside2 });
    // Sold but move date is OUTSIDE window → not counted
    const l3 = await seedLead({ created_at: w.inside });
    await seedVendidoEntry(l3, { closedAt: null });
    await seedVendidoHistory(l3, w.before);

    const c = await counts(w.from, w.to);
    expect(c.vendido).toBe(2);

    const rows = await drill('vendido', w.from, w.to);
    expect(rows.length).toBe(2);
  });

  it('seller filter narrows by canonical attribution (Pré-vendas / Closer / responsável)', async () => {
    const w = win(6);
    // TM1 meetings, TM1 sale, TM1 new lead
    const a = await seedLead({ created_at: w.inside, responsible_id: TM1, sale_responsible_id: TM1 });
    await seedMeeting(a, 'meeting_booked', { occurredAt: w.inside, presale: TM1 });
    await seedMeeting(a, 'meeting_held', { meetingDate: w.inside2, presale: TM1 });
    await seedVendidoEntry(a, { closedAt: w.inside });
    await seedVendidoHistory(a, w.inside);
    // TM2 meetings, TM2 sale, TM2 new lead
    const b = await seedLead({ created_at: w.inside, responsible_id: TM2, sale_responsible_id: TM2 });
    await seedMeeting(b, 'meeting_booked', { occurredAt: w.inside, presale: TM2 });
    await seedVendidoEntry(b, { closedAt: w.inside });
    await seedVendidoHistory(b, w.inside);

    const all = await counts(w.from, w.to);
    expect(all.novos_leads).toBe(2);
    expect(all.reunioes_marcadas).toBe(2);
    expect(all.vendido).toBe(2);

    const onlyTm1 = await counts(w.from, w.to, TM1);
    expect(onlyTm1.novos_leads).toBe(1);
    expect(onlyTm1.reunioes_marcadas).toBe(1);
    expect(onlyTm1.reunioes_realizadas).toBe(1);
    expect(onlyTm1.vendido).toBe(1);

    // Drill respects the seller narrow.
    const tm1Rows = await drill('reunioes_marcadas', w.from, w.to, TM1);
    expect(tm1Rows.length).toBe(1);
    expect(tm1Rows[0].seller_id).toBe(TM1);
  });

  it('multi-tenant: org A call never sees org B data', async () => {
    const w = win(7);
    // Seed everything under org B
    const lb = await seedLead({ created_at: w.inside, organization_id: ORG_B });
    await seedMeeting(lb, 'meeting_booked', { occurredAt: w.inside, org: ORG_B });
    await seedMeeting(lb, 'meeting_held', { meetingDate: w.inside, org: ORG_B });
    await seedVendidoEntry(lb, { closedAt: w.inside, pipelineId: PIPELINE_PROPOSTAS_B_ID, org: ORG_B });
    await seedVendidoHistory(lb, w.inside, ORG_B);

    const a = await counts(w.from, w.to, null, ORG);
    expect(a.novos_leads).toBe(0);
    expect(a.reunioes_marcadas).toBe(0);
    expect(a.reunioes_realizadas).toBe(0);
    expect(a.vendido).toBe(0);

    const b = await counts(w.from, w.to, null, ORG_B);
    expect(b.novos_leads).toBe(1);
    expect(b.reunioes_marcadas).toBe(1);
    expect(b.vendido).toBe(1);
  });
});
