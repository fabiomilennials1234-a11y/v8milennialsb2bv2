// @vitest-environment node
/**
 * Integration — get_productivity_activity_by_seller (Produtividade · placar por vendedor).
 *
 * Mesma semântica event-anchored de get_productivity_activity (ADR-0013), agregada
 * por vendedor: uma linha por team_member ATIVO com atividade no período.
 *   - Marcadas/Realizadas → meeting_events por pre_sale_responsible_id.
 *   - Vendido             → system 'propostas', datado pelo move durável (lead_history).
 *   - Só vendedores is_active=true e com atividade > 0 aparecem.
 *   - Ordenado por realizadas desc, marcadas desc, vendido desc.
 *
 * Prereqs: `supabase start` + migrations, OU SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabase } from './setup';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

const ORG = 'ffffffff-0000-4000-a000-00000000e101';
const ORG_B = 'ffffffff-0000-4000-a000-00000000e102';
const PIPE = 'ffffffff-0000-4000-a000-0000000000f1';
const PIPE_B = 'ffffffff-0000-4000-a000-0000000000f2';
const PRESALE = 'ffffffff-0000-4000-a000-0000000000c1'; // metric_type meetings
const CLOSER = 'ffffffff-0000-4000-a000-0000000000c2'; // metric_type sales
const INACTIVE = 'ffffffff-0000-4000-a000-0000000000c3'; // is_active=false

let seq = 0;

interface Row {
  seller_id: string;
  seller_name: string;
  metric_type: string | null;
  novos_leads: number;
  reunioes_marcadas: number;
  reunioes_realizadas: number;
  vendido: number;
}

function win(monthIdx: number) {
  const m = String(monthIdx).padStart(2, '0');
  const pm = String(monthIdx - 1).padStart(2, '0');
  return {
    from: `2033-${m}-01T00:00:00Z`,
    to: `2033-${m}-28T23:59:59Z`,
    inside: `2033-${m}-10T12:00:00Z`,
    inside2: `2033-${m}-20T12:00:00Z`,
    before: `2033-${pm}-10T12:00:00Z`,
  };
}

async function seedLead(o: Partial<{ organization_id: string; created_at: string; sale_responsible_id: string; responsible_id: string }> = {}) {
  seq += 1;
  const { data, error } = await supabase
    .from('leads')
    .insert({ organization_id: ORG, name: `Seller Fixture ${seq}`, company: `Co ${seq}`, phone: `+5599955${String(seq).padStart(6, '0')}`, ...o })
    .select('id')
    .single();
  if (error) throw new Error(`seedLead: ${error.message}`);
  return data.id as string;
}

async function seedMeeting(leadId: string, type: 'meeting_booked' | 'meeting_held', o: { occurredAt?: string; meetingDate?: string; presale?: string; org?: string } = {}) {
  const { error } = await supabase.from('meeting_events').insert({
    organization_id: o.org ?? ORG,
    lead_id: leadId,
    event_type: type,
    occurred_at: o.occurredAt ?? new Date().toISOString(),
    meeting_date: o.meetingDate ?? null,
    pre_sale_responsible_id: o.presale ?? null,
    source: 'integration-test',
  });
  if (error) throw new Error(`seedMeeting: ${error.message}`);
}

async function seedVendido(leadId: string, o: { at: string; closer?: string; org?: string; pipe?: string }) {
  const { error: e1 } = await supabase.from('pipeline_entries').insert({
    organization_id: o.org ?? ORG,
    pipeline_id: o.pipe ?? PIPE,
    lead_id: leadId,
    stage_key: 'vendido',
    closed_at: o.at,
    metadata: o.closer ? { closer_id: o.closer } : {},
  });
  if (e1) throw new Error(`seedVendido entry: ${e1.message}`);
  const { error: e2 } = await supabase.from('lead_history').insert({
    organization_id: o.org ?? ORG,
    lead_id: leadId,
    action: 'stage_changed',
    description: 'Etapa alterada para "Vendido"',
    metadata: { to_stage: 'vendido', pipe_slug: 'propostas' },
    created_at: o.at,
  });
  if (e2) throw new Error(`seedVendido history: ${e2.message}`);
}

async function board(from: string, to: string, org = ORG): Promise<Row[]> {
  const { data, error } = await supabase.rpc('get_productivity_activity_by_seller', {
    p_org_id: org,
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(`rpc board: ${error.message}`);
  return (data as Row[]) ?? [];
}

describe.skipIf(shouldSkip)('get_productivity_activity_by_seller RPC', () => {
  beforeAll(async () => {
    for (const [id, name, slug] of [
      [ORG, 'Seller Board Org A', 'seller-board-a'],
      [ORG_B, 'Seller Board Org B', 'seller-board-b'],
    ]) {
      const { error } = await supabase.from('organizations').upsert({ id, name, slug }, { onConflict: 'id' });
      if (error) throw new Error(error.message);
    }
    for (const t of ['meeting_events', 'pipeline_entries', 'lead_history', 'leads']) {
      await supabase.from(t).delete().in('organization_id', [ORG, ORG_B]);
    }
    for (const [id, org] of [[PIPE, ORG], [PIPE_B, ORG_B]]) {
      const { error } = await supabase.from('pipelines').upsert(
        { id, organization_id: org, name: 'Propostas (fixture)', slug: 'propostas', type: 'system' },
        { onConflict: 'id' },
      );
      if (error) throw new Error(error.message);
    }
    const { error } = await supabase.from('team_members').upsert(
      [
        { id: PRESALE, organization_id: ORG, name: 'Ana Pré', role: 'member', metric_type: 'meetings', is_active: true },
        { id: CLOSER, organization_id: ORG, name: 'Bruno Closer', role: 'member', metric_type: 'sales', is_active: true },
        { id: INACTIVE, organization_id: ORG, name: 'Carlos Inativo', role: 'member', metric_type: 'sales', is_active: false },
      ],
      { onConflict: 'id' },
    );
    if (error) throw new Error(error.message);
  });

  afterAll(async () => {
    for (const t of ['meeting_events', 'pipeline_entries', 'lead_history', 'leads', 'pipelines', 'team_members', 'organizations']) {
      const col = t === 'organizations' ? 'id' : 'organization_id';
      await supabase.from(t).delete().in(col, [ORG, ORG_B]);
    }
  });

  it('per-seller: cada pessoa aparece com suas próprias contagens, event-anchored', async () => {
    const w = win(2);
    // Ana (pré-venda): 3 marcadas, 2 realizadas — lead nascido ANTES da janela (anti-cohort)
    for (let i = 0; i < 3; i++) {
      const l = await seedLead({ created_at: w.before });
      await seedMeeting(l, 'meeting_booked', { occurredAt: w.inside, presale: PRESALE });
      if (i < 2) await seedMeeting(l, 'meeting_held', { meetingDate: w.inside2, presale: PRESALE });
    }
    // Bruno (closer): 2 vendas na janela
    for (let i = 0; i < 2; i++) {
      const l = await seedLead({ created_at: w.before });
      await seedVendido(l, { at: w.inside, closer: CLOSER });
    }

    const rows = await board(w.from, w.to);
    const ana = rows.find((r) => r.seller_id === PRESALE);
    const bruno = rows.find((r) => r.seller_id === CLOSER);

    expect(ana).toBeTruthy();
    expect(ana!.reunioes_marcadas).toBe(3);
    expect(ana!.reunioes_realizadas).toBe(2);
    expect(ana!.vendido).toBe(0);
    expect(ana!.metric_type).toBe('meetings');

    expect(bruno).toBeTruthy();
    expect(bruno!.vendido).toBe(2);
    expect(bruno!.reunioes_marcadas).toBe(0);
    expect(bruno!.metric_type).toBe('sales');
  });

  it('só vendedores ATIVOS e com atividade aparecem', async () => {
    const w = win(3);
    // atividade atribuída a um membro INATIVO → não deve aparecer
    const l = await seedLead({ created_at: w.before });
    await seedVendido(l, { at: w.inside, closer: INACTIVE });
    // um ativo sem atividade nenhuma → também não aparece
    const rows = await board(w.from, w.to);
    expect(rows.find((r) => r.seller_id === INACTIVE)).toBeUndefined();
    expect(rows.find((r) => r.seller_id === PRESALE)).toBeUndefined(); // sem atividade nesta janela
  });

  it('ordenado por realizadas desc, marcadas desc', async () => {
    const w = win(4);
    // Ana: 1 marcada, 1 realizada; Bruno: 5 marcadas, 0 realizadas
    const a = await seedLead({ created_at: w.before });
    await seedMeeting(a, 'meeting_booked', { occurredAt: w.inside, presale: PRESALE });
    await seedMeeting(a, 'meeting_held', { meetingDate: w.inside, presale: PRESALE });
    for (let i = 0; i < 5; i++) {
      const l = await seedLead({ created_at: w.before });
      await seedMeeting(l, 'meeting_booked', { occurredAt: w.inside, presale: CLOSER });
    }
    const rows = await board(w.from, w.to);
    // Ana (1 realizada) vem antes de Bruno (0 realizadas), apesar de menos marcadas
    expect(rows[0].seller_id).toBe(PRESALE);
    expect(rows[1].seller_id).toBe(CLOSER);
  });

  it('multi-tenant: org A nunca vê dados de org B', async () => {
    const w = win(5);
    const lb = await seedLead({ organization_id: ORG_B, created_at: w.before });
    await seedMeeting(lb, 'meeting_booked', { occurredAt: w.inside, presale: PRESALE, org: ORG_B });
    const rowsA = await board(w.from, w.to, ORG);
    expect(rowsA.length).toBe(0);
  });
});
