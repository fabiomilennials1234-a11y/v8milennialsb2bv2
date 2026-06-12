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
  occurredAt: string
) {
  const { error } = await supabase.from('meeting_events').insert({
    organization_id: ORG,
    lead_id: leadId,
    event_type: eventType,
    occurred_at: occurredAt,
    source: 'integration-test',
  });
  if (error) throw new Error(`seedMeeting failed: ${error.message}`);
}

const PIPELINE_PROPOSTAS_ID = 'ffffffff-0000-4000-a000-0000000000d1';
const TM1 = 'ffffffff-0000-4000-a000-0000000000a1';
const TM2 = 'ffffffff-0000-4000-a000-0000000000a2';

async function seedPropostaEntry(leadId: string, stageKey: string) {
  const { error } = await supabase.from('pipeline_entries').insert({
    organization_id: ORG,
    pipeline_id: PIPELINE_PROPOSTAS_ID,
    lead_id: leadId,
    stage_key: stageKey,
  });
  if (error) throw new Error(`seedPropostaEntry failed: ${error.message}`);
}

async function callRpc(monthIdx: number, orgId: string = ORG) {
  const w = window(monthIdx);
  const { data, error } = await supabase.rpc('get_funnel_health', {
    p_org_id: orgId,
    p_start_date: w.start,
    p_end_date: w.end,
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
});
