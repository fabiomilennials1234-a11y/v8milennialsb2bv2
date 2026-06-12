// @vitest-environment node
/**
 * Integration tests — get_funnel_health RPC (Indicador de Saúde do Funil).
 *
 * Semantics locked in CONTEXT.md (Funnel Health Indicator):
 *   - COHORT: the filter is the Lead's CREATION period; each block counts
 *     cohort members that have EVER reached it (events at any time).
 *   - Tratado/Avaliado: effective tier set (any tier, incl. desqualificado).
 *   - Qualificado/Bom: effective tier in prata/ouro/diamante (bronze is OUT);
 *     final qualification beats pre-qualification.
 *   - Agendado/Compareceu: meeting_events (meeting_booked / meeting_held).
 *   - Vendido: propostas pipeline entry with stage_key 'vendido'.
 *   - Seller matrix: Pré-vendas attribution with legacy fallback
 *     COALESCE(pre_sale_responsible_id, sdr_id, responsible_id).
 *
 * Each test isolates itself by using a distinct creation-time WINDOW within a
 * dedicated test org, so counts are absolute per test.
 *
 * Prerequisites: local `supabase start` + migrations, OR point at a remote
 * project via SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY envs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabase } from './setup';

const shouldSkip =
  !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

// Dedicated fixture org ids (never collide with seeds/real data)
const ORG = 'ffffffff-0000-4000-a000-00000000f001';
const ORG_B = 'ffffffff-0000-4000-a000-00000000f002';

let leadSeq = 0;

/** Distinct creation window per test → absolute counts per test. */
function window(monthIdx: number) {
  const m = String(monthIdx).padStart(2, '0');
  return {
    start: `2030-${m}-01T00:00:00Z`,
    end: `2030-${m}-28T23:59:59Z`,
    inside: `2030-${m}-10T12:00:00Z`,
    before: `2030-${String(monthIdx - 1).padStart(2, '0')}-10T12:00:00Z`,
  };
}

interface LeadOverrides {
  organization_id?: string;
  created_at?: string;
  origin?: string | null;
  deleted_at?: string | null;
  qualification_tier?: string | null;
  pre_qualification_tier?: string | null;
  pre_sale_responsible_id?: string | null;
  sdr_id?: string | null;
  responsible_id?: string | null;
}

async function seedLead(overrides: LeadOverrides): Promise<string> {
  leadSeq += 1;
  const { data, error } = await supabase
    .from('leads')
    .insert({
      organization_id: ORG,
      name: `Funnel Health Fixture ${leadSeq}`,
      phone: `+5599911${String(leadSeq).padStart(6, '0')}`,
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
  occurredAt: string,
  meetingDate?: string
) {
  const { error } = await supabase.from('meeting_events').insert({
    organization_id: ORG,
    lead_id: leadId,
    event_type: eventType,
    occurred_at: occurredAt,
    ...(meetingDate ? { meeting_date: meetingDate } : {}),
    source: 'integration-test',
  });
  if (error) throw new Error(`seedMeeting failed: ${error.message}`);
}

const PIPELINE_PROPOSTAS_ID = 'ffffffff-0000-4000-a000-0000000000d1';
const TM1 = 'ffffffff-0000-4000-a000-0000000000a1';
const TM2 = 'ffffffff-0000-4000-a000-0000000000a2';

async function seedPropostaEntry(
  leadId: string,
  stageKey: string,
  metadata?: object,
  closedAt?: string
) {
  const { error } = await supabase.from('pipeline_entries').insert({
    organization_id: ORG,
    pipeline_id: PIPELINE_PROPOSTAS_ID,
    lead_id: leadId,
    stage_key: stageKey,
    ...(metadata ? { metadata } : {}),
    ...(closedAt ? { closed_at: closedAt, stage_changed_at: closedAt } : {}),
  });
  if (error) throw new Error(`seedPropostaEntry failed: ${error.message}`);
}

async function callRpc(monthIdx: number, orgId: string = ORG, origins?: string[]) {
  const w = window(monthIdx);
  const { data, error } = await supabase.rpc('get_funnel_health', {
    p_org_id: orgId,
    p_start_date: w.start,
    p_end_date: w.end,
    ...(origins !== undefined ? { p_origins: origins } : {}),
  });
  if (error) throw new Error(`rpc failed: ${error.message}`);
  return data;
}

describe.skipIf(shouldSkip)('get_funnel_health RPC', () => {
  beforeAll(async () => {
    for (const [id, name, slug] of [
      [ORG, 'Funnel Health Test Org A', 'funnel-health-test-a'],
      [ORG_B, 'Funnel Health Test Org B', 'funnel-health-test-b'],
    ]) {
      const { error } = await supabase
        .from('organizations')
        .upsert({ id, name, slug }, { onConflict: 'id' });
      if (error) throw new Error(`org seed failed: ${error.message}`);
    }
    // Fresh start: wipe fixture-org data from previous (possibly failed) runs.
    for (const table of ['meeting_events', 'pipeline_entries', 'lead_history', 'leads']) {
      await supabase.from(table).delete().in('organization_id', [ORG, ORG_B]);
    }

    const { error: pipeErr } = await supabase.from('pipelines').upsert(
      {
        id: PIPELINE_PROPOSTAS_ID,
        organization_id: ORG,
        name: 'Orçamentos (fixture)',
        slug: 'propostas',
        type: 'system',
      },
      { onConflict: 'id' }
    );
    if (pipeErr) throw new Error(`pipeline seed failed: ${pipeErr.message}`);

    const { error: tmErr } = await supabase.from('team_members').upsert(
      [
        // is_active:false dodges the seat-limit billing trigger; attribution only needs the row
        { id: TM1, organization_id: ORG, name: 'Pré-vendas Um', role: 'member', is_active: false },
        { id: TM2, organization_id: ORG, name: 'Pré-vendas Dois', role: 'member', is_active: false },
      ],
      { onConflict: 'id' }
    );
    if (tmErr) throw new Error(`team_members seed failed: ${tmErr.message}`);
  });

  afterAll(async () => {
    // FK order: children → parents. Best-effort per table.
    for (const table of [
      'meeting_events',
      'pipeline_entries',
      'lead_history',
      'leads',
      'pipeline_stages',
      'pipelines',
      'loss_reasons',
      'team_members',
      'organizations',
    ]) {
      const col = table === 'organizations' ? 'id' : 'organization_id';
      await supabase.from(table).delete().in(col, [ORG, ORG_B]);
    }
  });

  it('cohort counts leads created inside the period only (excludes out-of-period, soft-deleted, other orgs)', async () => {
    const M = 2;
    const w = window(M);
    await seedLead({ created_at: w.inside }); // counts
    await seedLead({ created_at: w.before }); // out of period
    await seedLead({ created_at: w.inside, deleted_at: w.inside }); // soft-deleted
    await seedLead({ created_at: w.inside, organization_id: ORG_B }); // other org

    const res = await callRpc(M);

    expect(res.cohort_total).toBe(1);
    expect(res.stages.entraram).toBe(1);
  });

  it('avaliados counts any effective tier — pre or final, including desqualificado', async () => {
    const M = 3;
    const w = window(M);
    await seedLead({ created_at: w.inside, qualification_tier: 'ouro' });
    await seedLead({ created_at: w.inside, pre_qualification_tier: 'bronze' });
    await seedLead({ created_at: w.inside, qualification_tier: 'desqualificado' });
    await seedLead({ created_at: w.inside }); // no tier → not avaliado

    const res = await callRpc(M);

    expect(res.stages.entraram).toBe(4);
    expect(res.stages.avaliados).toBe(3);
  });

  it('bons = effective tier prata/ouro/diamante; bronze is out; final qualification beats pre', async () => {
    const M = 4;
    const w = window(M);
    await seedLead({ created_at: w.inside, qualification_tier: 'prata' }); // bom
    await seedLead({ created_at: w.inside, pre_qualification_tier: 'diamante' }); // bom (só pré)
    await seedLead({ created_at: w.inside, qualification_tier: 'bronze' }); // avaliado, não bom
    await seedLead({
      created_at: w.inside,
      pre_qualification_tier: 'diamante',
      qualification_tier: 'desqualificado', // final vence → não bom
    });
    await seedLead({
      created_at: w.inside,
      pre_qualification_tier: 'bronze',
      qualification_tier: 'ouro', // final vence → bom
    });

    const res = await callRpc(M);

    expect(res.stages.avaliados).toBe(5);
    expect(res.stages.bons).toBe(3);
  });

  it('reuniao/compareceram count cohort leads with meeting events at ANY time, deduped per lead', async () => {
    const M = 5;
    const w = window(M);
    const l1 = await seedLead({ created_at: w.inside }); // booked twice → counts once
    const l2 = await seedLead({ created_at: w.inside }); // booked + held (event AFTER window end)
    await seedLead({ created_at: w.inside }); // no meetings

    await seedMeeting(l1, 'meeting_booked', w.inside);
    await seedMeeting(l1, 'meeting_booked', '2030-12-01T10:00:00Z');
    await seedMeeting(l2, 'meeting_booked', w.inside);
    await seedMeeting(l2, 'meeting_held', '2031-01-15T10:00:00Z'); // way after period → still counts

    const res = await callRpc(M);

    expect(res.stages.reuniao).toBe(2);
    expect(res.stages.compareceram).toBe(1);
  });

  it('compraram counts cohort leads with a vendido entry in the propostas pipeline', async () => {
    const M = 6;
    const w = window(M);
    const l1 = await seedLead({ created_at: w.inside }); // vendido
    const l2 = await seedLead({ created_at: w.inside }); // proposta enviada, não vendido
    await seedLead({ created_at: w.inside }); // sem proposta

    await seedPropostaEntry(l1, 'vendido');
    await seedPropostaEntry(l2, 'enviada');

    const res = await callRpc(M);

    expect(res.stages.compraram).toBe(1);
  });

  it('tiers distribution uses effective tier; depth splits pre-only vs final-validated', async () => {
    const M = 7;
    const w = window(M);
    await seedLead({ created_at: w.inside, qualification_tier: 'ouro' }); // final
    await seedLead({ created_at: w.inside, pre_qualification_tier: 'ouro' }); // pre_only
    await seedLead({
      created_at: w.inside,
      pre_qualification_tier: 'diamante',
      qualification_tier: 'prata', // effective = prata
    });
    await seedLead({ created_at: w.inside, pre_qualification_tier: 'bronze' }); // pre_only
    await seedLead({ created_at: w.inside, qualification_tier: 'desqualificado' }); // final
    await seedLead({ created_at: w.inside }); // não avaliado — fora de tiers/depth

    const res = await callRpc(M);

    expect(res.tiers).toEqual({ diamante: 0, ouro: 2, prata: 1, bronze: 1, desqualificado: 1 });
    expect(res.depth).toEqual({ pre_only: 2, final: 3 });
  });

  it('p_origins filters the cohort to the given origins; null/omitted keeps everything', async () => {
    const M = 8;
    const w = window(M);
    await seedLead({ created_at: w.inside, origin: 'meta_ads', qualification_tier: 'ouro' });
    await seedLead({ created_at: w.inside, origin: 'instagram' });
    await seedLead({ created_at: w.inside, origin: 'site' });
    await seedLead({ created_at: w.inside }); // origem default do schema

    const all = await callRpc(M);
    expect(all.cohort_total).toBe(4);

    const one = await callRpc(M, ORG, ['meta_ads']);
    expect(one.cohort_total).toBe(1);
    expect(one.stages.avaliados).toBe(1);

    const two = await callRpc(M, ORG, ['meta_ads', 'instagram']);
    expect(two.cohort_total).toBe(2);

    const empty = await callRpc(M, ORG, []);
    expect(empty.cohort_total).toBe(4); // array vazio = sem filtro
  });

  it('cycles: averages lead→sale over cohort sales and meeting→sale over sales with a held meeting', async () => {
    const M = 12;
    // l1: entrou dia 10, reunião dia 20 (10d), vendeu dia 25 (15d total, 5d pós-reunião)
    const l1 = await seedLead({ created_at: '2030-12-10T12:00:00Z' });
    await seedMeeting(l1, 'meeting_held', '2030-12-20T12:00:00Z');
    await seedPropostaEntry(l1, 'vendido', undefined, '2030-12-25T12:00:00Z');
    // l2: entrou dia 10, vendeu dia 20 (10d), sem reunião registrada
    const l2 = await seedLead({ created_at: '2030-12-10T12:00:00Z' });
    await seedPropostaEntry(l2, 'vendido', undefined, '2030-12-20T12:00:00Z');
    // l3: na coorte, sem venda — fora das médias
    await seedLead({ created_at: '2030-12-10T12:00:00Z' });

    const res = await callRpc(M);

    expect(res.cycles.sales_count).toBe(2);
    expect(res.cycles.lead_to_sale_days).toBeCloseTo(12.5, 1); // (15+10)/2
    expect(res.cycles.meeting_sales_count).toBe(1);
    expect(res.cycles.meeting_to_sale_days).toBeCloseTo(5, 1);
    expect(res.cycles.lead_to_meeting_days).toBeCloseTo(10, 1);

    // sem vendas no recorte → contagens zeradas e médias nulas
    const none = await callRpc(M, ORG, ['evento']);
    expect(none.cycles.sales_count).toBe(0);
    expect(none.cycles.lead_to_sale_days).toBeNull();
    expect(none.cycles.meeting_to_sale_days).toBeNull();
  });

  it('sellers matrix credits the Pré-vendas (with legacy fallback) and buckets unassigned leads', async () => {
    const M = 9;
    const w = window(M);
    // TM1 canonical + full journey
    const lA = await seedLead({
      created_at: w.inside,
      pre_sale_responsible_id: TM1,
      qualification_tier: 'ouro',
    });
    // TM1 via fallback (sdr beats responsible)
    await seedLead({ created_at: w.inside, sdr_id: TM1, responsible_id: TM2 });
    // TM2 via responsible fallback, avaliado mas não bom
    await seedLead({
      created_at: w.inside,
      responsible_id: TM2,
      qualification_tier: 'desqualificado',
    });
    // sem pré-vendas
    await seedLead({ created_at: w.inside });

    await seedMeeting(lA, 'meeting_booked', w.inside);
    await seedMeeting(lA, 'meeting_held', w.inside);
    await seedPropostaEntry(lA, 'vendido');

    const res = await callRpc(M);

    const tm1 = res.sellers.find((s: any) => s.team_member_id === TM1);
    const tm2 = res.sellers.find((s: any) => s.team_member_id === TM2);
    const unassigned = res.sellers.find((s: any) => s.team_member_id === null);

    expect(tm1).toMatchObject({
      name: 'Pré-vendas Um',
      vinculados: 2,
      avaliados: 1,
      bons: 1,
      reuniao: 1,
      compareceram: 1,
      compraram: 1,
    });
    expect(tm2).toMatchObject({ vinculados: 1, avaliados: 1, bons: 0 });
    expect(unassigned).toMatchObject({ vinculados: 1, avaliados: 0 });
  });

  it('stage_leads: returns only the leads of the requested stage, newest first', async () => {
    const M = 10;
    const w = window(M);
    await seedLead({ created_at: w.inside, qualification_tier: 'ouro' }); // bom
    await seedLead({ created_at: '2030-10-12T12:00:00Z', pre_qualification_tier: 'diamante' }); // bom, mais novo
    await seedLead({ created_at: w.inside, qualification_tier: 'bronze' }); // não bom
    await seedLead({ created_at: w.inside }); // não avaliado

    const { data, error } = await supabase.rpc('get_funnel_health_stage_leads', {
      p_org_id: ORG,
      p_start_date: w.start,
      p_end_date: w.end,
      p_stage: 'bons',
    });
    if (error) throw new Error(error.message);

    expect(data).toHaveLength(2);
    expect(data[0].tier).toBe('diamante'); // created 12/10 — newest first
    expect(data[1].tier).toBe('ouro');
    expect(data[0].name).toContain('Funnel Health Fixture');
  });

  it('stage_leads: enriches each lead with pre-vendas name, propostas status + value, and meeting dates', async () => {
    const M = 11;
    const w = window(M);
    const sold = await seedLead({
      created_at: w.inside,
      qualification_tier: 'diamante',
      pre_sale_responsible_id: TM1,
    });
    await seedMeeting(sold, 'meeting_booked', w.inside, '2030-11-20');
    await seedMeeting(sold, 'meeting_held', '2030-11-20T15:00:00Z');
    await seedPropostaEntry(sold, 'vendido', { sale_value: 18400 });

    const bare = await seedLead({ created_at: '2030-11-09T12:00:00Z', pre_qualification_tier: 'ouro' });

    const { data, error } = await supabase.rpc('get_funnel_health_stage_leads', {
      p_org_id: ORG,
      p_start_date: w.start,
      p_end_date: w.end,
      p_stage: 'bons',
    });
    if (error) throw new Error(error.message);

    const rich = data.find((l: any) => l.id === sold);
    const plain = data.find((l: any) => l.id === bare);

    expect(rich).toMatchObject({
      pre_vendas: 'Pré-vendas Um',
      proposta_stage: 'vendido',
      sale_value: 18400,
    });
    expect(rich.meeting_date).toContain('2030-11-20');
    expect(rich.held_at).toBeTruthy();
    expect(plain).toMatchObject({
      pre_vendas: null,
      proposta_stage: null,
      sale_value: null,
      meeting_date: null,
      held_at: null,
      whatsapp_stage: null,
    });
  });

  it('stage_leads: respects p_origins like the main RPC', async () => {
    const start = '2031-01-01T00:00:00Z';
    const end = '2031-01-28T23:59:59Z';
    const inside = '2031-01-10T12:00:00Z';
    await seedLead({ created_at: inside, origin: 'meta_ads' });
    await seedLead({ created_at: inside, origin: 'instagram' });

    const { data, error } = await supabase.rpc('get_funnel_health_stage_leads', {
      p_org_id: ORG,
      p_start_date: start,
      p_end_date: end,
      p_stage: 'entraram',
      p_origins: ['meta_ads'],
    });
    if (error) throw new Error(error.message);

    expect(data).toHaveLength(1);
  });

  it('stage_leads: rejects an unknown stage', async () => {
    const w = window(11);
    const { error } = await supabase.rpc('get_funnel_health_stage_leads', {
      p_org_id: ORG,
      p_start_date: w.start,
      p_end_date: w.end,
      p_stage: 'xpto',
    });
    expect(error?.message).toContain('invalid_stage');
  });
});
