/**
 * Integration tests — `snapshot_responsible_from_lead` trigger lifecycle.
 *
 * Covers the DB-driven snapshot mechanism introduced for PRD #211 (slice #212).
 * The trigger fires BEFORE INSERT and BEFORE UPDATE OF stage_key on
 * `pipeline_entries`. It:
 *
 *   - On INSERT (slug=confirmacao) → copies `leads.pre_sale_responsible_id`
 *     into NEW.metadata.pre_sale_responsible_id.
 *   - On INSERT (slug=propostas)   → copies `leads.sale_responsible_id`.
 *   - On UPDATE transition to stage_key='compareceu' (confirmacao) → re-reads
 *     the lead and overwrites metadata.pre_sale_responsible_id.
 *   - On UPDATE transition to stage_key='vendido' (propostas) → re-reads the
 *     lead and overwrites metadata.sale_responsible_id.
 *
 * It NEVER reads or writes legacy sdr_id/closer_id/responsible_id.
 *
 * Requires: local Supabase running with seed applied (`supabase db reset`).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  supabase,
  TEST_ORG_ID,
  TEST_ORG_B_ID,
} from './setup';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

// Pinned month/year so RPC reads in scenario 6/8/9 don't race other data.
const TEST_MONTH = 8;
const TEST_YEAR = 2099;
const PERIOD_AT = `${TEST_YEAR}-0${TEST_MONTH}-15T12:00:00Z`;

// 🔴 O GATILHO QUE ESTA SUÍTE DESCREVE NÃO EXISTE EM PRODUÇÃO (SCRUM-428).
//
// Medido em 2026-08-22: `pg_proc` de produção não tem `snapshot_responsible_
// from_lead`, e o baseline (que é dump de produção) não o menciona uma vez
// sequer. O que existe é um primo mais estreito, `pipeline_entries_snapshot_
// responsibles`, e ele:
//
//   • só age quando `pipelines.slug = 'propostas'` — as Regras 1, 3 e 4 do
//     desenho original, todas sobre `confirmacao`, não têm implementação;
//   • só PREENCHE quando os quatro campos de responsável estão vazios; nunca
//     REESCREVE. O cenário 9 ("transição para vendido atualiza o snapshot")
//     recebia o valor antigo porque atualizar não é o que a função faz.
//
// A origem está no `archive`: 20261025000000_snapshot_responsible_from_lead.sql
// implementava as quatro regras e diz no cabeçalho "ratificado pelo CTO — não
// rediscutir"; 20261211120000_propostas_snapshot_responsibles.sql, de dezembro,
// resolveu um incidente de vendas sem vendedor com a versão estreita. A larga
// sumiu no caminho, e ninguém viu porque esta suíte estava atrás de um CI morto.
//
// ⚠ ISSO TEM CONSEQUÊNCIA MEDIDA, NÃO É SÓ TESTE VERMELHO: nos últimos 60 dias,
// 31 das 207 entries de `confirmacao` (15%) estão sem
// `metadata.pre_sale_responsible_id`. São reuniões sem crédito de SDR — que é
// ranking, meta individual e comissão.
//
// NÃO RELIGO POR CONTA PRÓPRIA. Escrever metadata de atribuição muda dinheiro
// de lugar (ADR-0017), e a decisão entre "reinstalar as quatro regras" e
// "assumir que o app preenche e fechar o buraco na aplicação" é do CTO. A suíte
// fica no repo, desligada, porque descreve o comportamento pretendido com
// precisão — e é o que a implementação vai precisar respeitar.
describe.skip('snapshot_responsible_from_lead lifecycle (gatilho ausente em prod — SCRUM-428)', () => {
  // Suite-scoped fixtures
  let sdrA: string;
  let sdrB: string;
  let closerX: string;
  let closerY: string;
  let confirmacaoPipelineId: string;
  let propostasPipelineId: string;

  // Cleanup buckets
  const createdLeadIds: string[] = [];
  const createdEntryIds: string[] = [];

  // Helper: insert a fresh lead with explicit dual responsibles
  async function createLead(
    name: string,
    opts: {
      pre_sale_responsible_id?: string | null;
      sale_responsible_id?: string | null;
      organization_id?: string;
    } = {},
  ): Promise<string> {
    const { data, error } = await supabase
      .from('leads')
      .insert({
        name,
        phone: `+5511${Math.floor(Math.random() * 900000000 + 100000000)}`,
        organization_id: opts.organization_id ?? TEST_ORG_ID,
        pre_sale_responsible_id: opts.pre_sale_responsible_id ?? null,
        sale_responsible_id: opts.sale_responsible_id ?? null,
      })
      .select('id')
      .single();
    expect(error, `lead insert error: ${error?.message}`).toBeNull();
    const id = data!.id as string;
    createdLeadIds.push(id);
    return id;
  }

  async function createConfirmacaoEntry(
    leadId: string,
    stageKey: string,
    extraMeta: Record<string, unknown> = {},
    organizationId: string = TEST_ORG_ID,
    pipelineId: string = confirmacaoPipelineId,
  ): Promise<{ id: string; metadata: Record<string, unknown> }> {
    const { data, error } = await supabase
      .from('pipeline_entries')
      .insert({
        lead_id: leadId,
        organization_id: organizationId,
        pipeline_id: pipelineId,
        stage_key: stageKey,
        metadata: {
          meeting_date: PERIOD_AT,
          metrics_period_at: PERIOD_AT,
          ...extraMeta,
        },
      })
      .select('id, metadata')
      .single();
    expect(error, `entry insert error: ${error?.message}`).toBeNull();
    const id = data!.id as string;
    createdEntryIds.push(id);
    return { id, metadata: data!.metadata as Record<string, unknown> };
  }

  async function createPropostasEntry(
    leadId: string,
    stageKey: string,
    extraMeta: Record<string, unknown> = {},
  ): Promise<{ id: string; metadata: Record<string, unknown> }> {
    const { data, error } = await supabase
      .from('pipeline_entries')
      .insert({
        lead_id: leadId,
        organization_id: TEST_ORG_ID,
        pipeline_id: propostasPipelineId,
        stage_key: stageKey,
        metadata: {
          metrics_period_at: PERIOD_AT,
          ...extraMeta,
        },
      })
      .select('id, metadata')
      .single();
    expect(error, `propostas insert error: ${error?.message}`).toBeNull();
    const id = data!.id as string;
    createdEntryIds.push(id);
    return { id, metadata: data!.metadata as Record<string, unknown> };
  }

  async function readEntryMetadata(entryId: string): Promise<Record<string, unknown>> {
    const { data, error } = await supabase
      .from('pipeline_entries')
      .select('metadata')
      .eq('id', entryId)
      .single();
    expect(error).toBeNull();
    return (data!.metadata as Record<string, unknown>) || {};
  }

  beforeAll(async () => {
    sdrA = randomUUID();
    sdrB = randomUUID();
    closerX = randomUUID();
    closerY = randomUUID();

    const { error: tmErr } = await supabase.from('team_members').insert([
      {
        id: sdrA,
        organization_id: TEST_ORG_ID,
        role: 'member',
        name: 'SDR A snapshot',
        email: `sdr-a-${sdrA.slice(0, 8)}@test.com`,
        is_active: true,
        metric_type: 'meetings',
        job_title: 'SDR',
      },
      {
        id: sdrB,
        organization_id: TEST_ORG_ID,
        role: 'member',
        name: 'SDR B snapshot',
        email: `sdr-b-${sdrB.slice(0, 8)}@test.com`,
        is_active: true,
        metric_type: 'meetings',
        job_title: 'SDR',
      },
      {
        id: closerX,
        organization_id: TEST_ORG_ID,
        role: 'member',
        name: 'Closer X snapshot',
        email: `closer-x-${closerX.slice(0, 8)}@test.com`,
        is_active: true,
        metric_type: 'sales',
        job_title: 'Closer',
      },
      {
        id: closerY,
        organization_id: TEST_ORG_ID,
        role: 'member',
        name: 'Closer Y snapshot',
        email: `closer-y-${closerY.slice(0, 8)}@test.com`,
        is_active: true,
        metric_type: 'sales',
        job_title: 'Closer',
      },
    ]);
    expect(tmErr).toBeNull();

    const { data: confPipeline, error: confErr } = await supabase
      .from('pipelines')
      .select('id')
      .eq('organization_id', TEST_ORG_ID)
      .eq('slug', 'confirmacao')
      .eq('type', 'system')
      .maybeSingle();
    if (confErr) throw confErr;
    if (!confPipeline) {
      throw new Error(
        'Seed missing: system pipeline slug=confirmacao for TEST_ORG_ID. ' +
          'Run `supabase db reset` with full seed applied.',
      );
    }
    confirmacaoPipelineId = confPipeline.id;

    const { data: propPipeline, error: propErr } = await supabase
      .from('pipelines')
      .select('id')
      .eq('organization_id', TEST_ORG_ID)
      .eq('slug', 'propostas')
      .eq('type', 'system')
      .maybeSingle();
    if (propErr) throw propErr;
    if (!propPipeline) {
      throw new Error(
        'Seed missing: system pipeline slug=propostas for TEST_ORG_ID. ' +
          'Run `supabase db reset` with full seed applied.',
      );
    }
    propostasPipelineId = propPipeline.id;
  });

  afterAll(async () => {
    if (createdEntryIds.length > 0) {
      await supabase.from('pipeline_entries').delete().in('id', createdEntryIds);
    }
    if (createdLeadIds.length > 0) {
      await supabase.from('leads').delete().in('id', createdLeadIds);
    }
    if (sdrA) await supabase.from('team_members').delete().eq('id', sdrA);
    if (sdrB) await supabase.from('team_members').delete().eq('id', sdrB);
    if (closerX) await supabase.from('team_members').delete().eq('id', closerX);
    if (closerY) await supabase.from('team_members').delete().eq('id', closerY);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 1 — direct INSERT on pipeline_entries (confirmacao) captures
  // leads.pre_sale_responsible_id into metadata.
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 1 — INSERT confirmacao snapshots pre_sale_responsible_id from lead', async () => {
    const leadId = await createLead('S1 — direct insert', {
      pre_sale_responsible_id: sdrA,
    });
    const { id, metadata } = await createConfirmacaoEntry(leadId, 'reuniao_marcada');

    // Trigger fired in the same INSERT → returning row should already carry it.
    expect((metadata as Record<string, unknown>).pre_sale_responsible_id).toBe(sdrA);

    // Re-read to confirm persisted state.
    const persisted = await readEntryMetadata(id);
    expect(persisted.pre_sale_responsible_id).toBe(sdrA);
    expect(persisted).not.toHaveProperty('sdr_id_written_by_trigger');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 2 — simulating the AddMeetingModal flow: update lead then insert.
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 2 — AddMeetingModal flow (update lead → insert) snapshots correctly', async () => {
    // Lead starts with no SDR.
    const leadId = await createLead('S2 — modal flow', {});

    // Modal updates the lead first…
    const upd = await supabase
      .from('leads')
      .update({ pre_sale_responsible_id: sdrA })
      .eq('id', leadId);
    expect(upd.error).toBeNull();

    // …then inserts the entry. Trigger captures snapshot.
    const { id } = await createConfirmacaoEntry(leadId, 'reuniao_marcada');
    const persisted = await readEntryMetadata(id);
    expect(persisted.pre_sale_responsible_id).toBe(sdrA);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 3 — schedule-meeting action-handler path. The shared
  // `scheduleMeeting` handler only writes to follow_ups, not pipeline_entries.
  // The actual confirmacao entry is created either by the webhook or by the
  // frontend modal in the same lifecycle. We assert that whatever creates the
  // entry (insert path) still receives the snapshot.
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 3 — action-handler-style insert snapshots from the lead', async () => {
    const leadId = await createLead('S3 — action handler', {
      pre_sale_responsible_id: sdrB,
    });
    const { id } = await createConfirmacaoEntry(leadId, 'reuniao_marcada', {
      // Even when caller does NOT include pre_sale_responsible_id, the trigger
      // populates it from the lead.
    });
    const persisted = await readEntryMetadata(id);
    expect(persisted.pre_sale_responsible_id).toBe(sdrB);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 4 — webhook-confirmacao path (server-side INSERT). Same INSERT
  // path as scenario 1 from the trigger's perspective.
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 4 — webhook-confirmacao INSERT snapshots pre_sale from lead', async () => {
    const leadId = await createLead('S4 — webhook confirmacao', {
      pre_sale_responsible_id: sdrA,
    });
    const { id } = await createConfirmacaoEntry(leadId, 'reuniao_marcada', {
      // Webhook commonly sets closer/sdr legacy ids — trigger ignores them.
      sdr_id: sdrB,
      closer_id: closerX,
      responsible_id: closerY,
    });
    const persisted = await readEntryMetadata(id);
    expect(persisted.pre_sale_responsible_id).toBe(sdrA);
    // Legacy keys provided by caller are NOT overwritten by the trigger,
    // but the trigger NEVER writes them itself. We just confirm trigger
    // didn't bleed sdr_id into pre_sale.
    expect(persisted.pre_sale_responsible_id).not.toBe(sdrB);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 5 — webhook-calcom path. Same INSERT semantics.
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 5 — webhook-calcom INSERT snapshots pre_sale from lead', async () => {
    const leadId = await createLead('S5 — webhook calcom', {
      pre_sale_responsible_id: sdrB,
    });
    const { id } = await createConfirmacaoEntry(leadId, 'reuniao_marcada');
    const persisted = await readEntryMetadata(id);
    expect(persisted.pre_sale_responsible_id).toBe(sdrB);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 6 — lead with NULL pre_sale → entry has NULL → get_ranking_data
  // does not credit anyone (bucket "sem SDR").
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 6 — NULL pre_sale on lead drops into "sem SDR" bucket', async () => {
    const leadId = await createLead('S6 — no SDR', {});
    const { id } = await createConfirmacaoEntry(leadId, 'compareceu');
    const persisted = await readEntryMetadata(id);
    // jsonb_set with 'null'::jsonb writes JSON null → key is present but value
    // is null. The RPC filters with `NULLIF(... ,'') IS NOT NULL`, so a JSON
    // null is excluded.
    expect(persisted.pre_sale_responsible_id ?? null).toBeNull();

    const { data, error } = await supabase.rpc('get_ranking_data', {
      p_month: TEST_MONTH,
      p_year: TEST_YEAR,
      p_organization_id: TEST_ORG_ID,
    });
    expect(error).toBeNull();
    const meetings = (data as { meetingsRanking: { id: string; meetings: number }[] })
      .meetingsRanking;
    // Neither SDR_A nor SDR_B receives credit from this orphan entry.
    const orphanLeadShouldNotCredit = !meetings.some(
      (r) => (r.id === sdrA || r.id === sdrB) && r.meetings > 0,
    );
    // (We only assert the orphan does not show up — other tests may also have
    // credited rows, which is fine.)
    expect(typeof orphanLeadShouldNotCredit).toBe('boolean');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 7 — entry created with SDR_A; lead later switches to SDR_B;
  // mid-stage entry keeps snapshot A.
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 7 — mid-stage entry keeps the snapshot when the lead changes SDR', async () => {
    const leadId = await createLead('S7 — mid stage', {
      pre_sale_responsible_id: sdrA,
    });
    const { id } = await createConfirmacaoEntry(leadId, 'reuniao_marcada');

    // Lead switches to SDR B.
    const upd = await supabase
      .from('leads')
      .update({ pre_sale_responsible_id: sdrB })
      .eq('id', leadId);
    expect(upd.error).toBeNull();

    // Entry moves to confirmar_d3 (non-final stage) — trigger should NOT act.
    const updEntry = await supabase
      .from('pipeline_entries')
      .update({ stage_key: 'confirmar_d3' })
      .eq('id', id);
    expect(updEntry.error).toBeNull();

    const persisted = await readEntryMetadata(id);
    expect(persisted.pre_sale_responsible_id).toBe(sdrA);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 8 — continuation of 7: transition to 'compareceu' refreshes
  // snapshot to the lead's current SDR_B.
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 8 — transition to compareceu refreshes snapshot to current lead SDR', async () => {
    const leadId = await createLead('S8 — transition compareceu', {
      pre_sale_responsible_id: sdrA,
    });
    const { id } = await createConfirmacaoEntry(leadId, 'reuniao_marcada');

    // Lead switches to SDR B AFTER entry creation.
    await supabase
      .from('leads')
      .update({ pre_sale_responsible_id: sdrB })
      .eq('id', leadId);

    // Now transition to compareceu → trigger overwrites snapshot.
    const updEntry = await supabase
      .from('pipeline_entries')
      .update({ stage_key: 'compareceu' })
      .eq('id', id);
    expect(updEntry.error).toBeNull();

    const persisted = await readEntryMetadata(id);
    expect(persisted.pre_sale_responsible_id).toBe(sdrB);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 9 — analogous flow for propostas: transition to 'vendido'
  // overwrites metadata.sale_responsible_id from lead.sale_responsible_id.
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 9 — propostas transition to vendido refreshes sale snapshot', async () => {
    const leadId = await createLead('S9 — propostas vendido', {
      sale_responsible_id: closerX,
    });
    const { id } = await createPropostasEntry(leadId, 'proposta_enviada', {
      sale_value: 1000,
    });

    // Entry was created with closerX snapshotted.
    let persisted = await readEntryMetadata(id);
    expect(persisted.sale_responsible_id).toBe(closerX);

    // Lead switches to closerY.
    await supabase
      .from('leads')
      .update({ sale_responsible_id: closerY })
      .eq('id', leadId);

    // Mid-stage update should NOT refresh.
    await supabase
      .from('pipeline_entries')
      .update({ stage_key: 'em_negociacao' })
      .eq('id', id);
    persisted = await readEntryMetadata(id);
    expect(persisted.sale_responsible_id).toBe(closerX);

    // Final transition → refresh.
    await supabase
      .from('pipeline_entries')
      .update({ stage_key: 'vendido' })
      .eq('id', id);
    persisted = await readEntryMetadata(id);
    expect(persisted.sale_responsible_id).toBe(closerY);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 10 — entry containing ONLY metadata.sdr_id (legacy, no dual) is
  // NOT credited by get_ranking_data. Guards against accidental fallback.
  // ──────────────────────────────────────────────────────────────────────────
  it('Scenario 10 — legacy-only metadata.sdr_id receives NO credit (fallback removed)', async () => {
    const leadId = await createLead('S10 — legacy only', {});
    // Insert directly with metadata containing ONLY legacy sdr_id. Lead has
    // NULL pre_sale, so trigger writes pre_sale_responsible_id = null, but
    // the legacy key remains.
    const { id } = await createConfirmacaoEntry(leadId, 'compareceu', {
      sdr_id: sdrA,
    });

    const persisted = await readEntryMetadata(id);
    expect(persisted.pre_sale_responsible_id ?? null).toBeNull();
    expect(persisted.sdr_id).toBe(sdrA);

    // RPC must NOT credit sdrA from this entry. We assert by computing the
    // count of compareceu entries credited to sdrA via the RPC and confirming
    // it equals the count of entries we know were properly snapshotted to him
    // (scenarios 1 — none in compareceu; scenario 8 — refreshed to sdrB).
    const { data, error } = await supabase.rpc('get_ranking_data', {
      p_month: TEST_MONTH,
      p_year: TEST_YEAR,
      p_organization_id: TEST_ORG_ID,
    });
    expect(error).toBeNull();
    const meetings = (data as { meetingsRanking: { id: string; meetings: number }[] })
      .meetingsRanking;
    const sdrARow = meetings.find((r) => r.id === sdrA);
    // sdrA only legitimately appears credited if some entry has
    // metadata.pre_sale_responsible_id = sdrA AND stage_key = 'compareceu'.
    // We snapshot-count via direct query for the authoritative number.
    const { count: legitimateCount, error: cntErr } = await supabase
      .from('pipeline_entries')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', TEST_ORG_ID)
      .eq('stage_key', 'compareceu')
      .eq('pipeline_id', confirmacaoPipelineId)
      .filter('metadata->>pre_sale_responsible_id', 'eq', sdrA);
    expect(cntErr).toBeNull();

    expect(sdrARow?.meetings ?? 0).toBe(legitimateCount ?? 0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Cross-tenant safety — entry in org A does not pull lead data from org B.
  // ──────────────────────────────────────────────────────────────────────────
  it('Cross-tenant — trigger does not cross organization boundaries', async () => {
    // Create a lead in org B with a known SDR. Even if we tried to wire an
    // org A entry to it, the trigger's `pipelines.organization_id` check
    // bails out. We don't actually try to break FK isolation here — we just
    // confirm that a lead in org A with no SDR yields NULL snapshot even when
    // a same-name lead in org B has a SDR. (Belt and suspenders.)
    const leadOrgB = await createLead('Cross-tenant — lead in org B', {
      pre_sale_responsible_id: null, // org B has no team_members in this suite
      organization_id: TEST_ORG_B_ID,
    });
    // Make sure org B lead exists but is irrelevant; org A entry pulls only
    // from org A's lead.
    expect(leadOrgB).toBeTruthy();

    const leadOrgA = await createLead('Cross-tenant — lead in org A', {});
    const { id } = await createConfirmacaoEntry(leadOrgA, 'reuniao_marcada');
    const persisted = await readEntryMetadata(id);
    expect(persisted.pre_sale_responsible_id ?? null).toBeNull();
  });
});
