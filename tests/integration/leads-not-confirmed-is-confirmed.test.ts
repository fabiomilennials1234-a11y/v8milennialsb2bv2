// @vitest-environment node
/**
 * Integration tests — get_leads_not_confirmed RPC (SP-0 fix #7).
 *
 * Regression: the old body excluded confirmed leads via `stage_key NOT IN
 * ('confirmada_no_dia', ...)`, but 'confirmada_no_dia' is a DEAD stage key
 * (migration 20260115142138 migrated every 'confirmada_no_dia' →
 * 'confirmacao_no_dia' and set is_confirmed=true). The clause was therefore a
 * no-op and already-confirmed leads kept surfacing as "not confirmed".
 *
 * The real confirmation signal is metadata.is_confirmed = true, set by
 * _shared/actions/schedule-meeting.ts (executeConfirmMeeting). The fix excludes
 * on that flag instead of the dead stage_key.
 *
 * These tests seed pipeline_entries in the 'confirmacao' system pipeline with a
 * meeting_date inside the alert window and assert membership in the RPC output.
 *
 * Prerequisites: local `supabase start` + migrations, OR point at a remote
 * project via SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY envs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabase } from './setup';

const shouldSkip =
  !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

// Dedicated fixture org (never collides with seeds/real data)
const ORG = 'ffffffff-0000-4000-a000-00000000f701';
const PIPELINE_CONFIRMACAO_ID = 'ffffffff-0000-4000-a000-0000000007c1';

// Alert window: meetings within the next 48h are "coming up".
const HOURS_WINDOW = 48;
const MINUTES_WINDOW = 0;
// A meeting 24h ahead is safely inside the window and in the future.
const MEETING_DATE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

let leadSeq = 0;

async function seedLead(): Promise<string> {
  leadSeq += 1;
  const { data, error } = await supabase
    .from('leads')
    .insert({
      organization_id: ORG,
      name: `NotConfirmed Fixture ${leadSeq}`,
      phone: `+5599977${String(leadSeq).padStart(6, '0')}`,
    })
    .select('id')
    .single();
  if (error) throw new Error(`seedLead failed: ${error.message}`);
  return data.id as string;
}

/** Seed a confirmacao pipeline entry with meeting_date + optional is_confirmed. */
async function seedConfirmacaoEntry(
  leadId: string,
  stageKey: string,
  isConfirmed: boolean | undefined
): Promise<void> {
  const metadata: Record<string, unknown> = { meeting_date: MEETING_DATE };
  if (isConfirmed !== undefined) metadata.is_confirmed = isConfirmed;

  const { error } = await supabase.from('pipeline_entries').insert({
    organization_id: ORG,
    pipeline_id: PIPELINE_CONFIRMACAO_ID,
    lead_id: leadId,
    stage_key: stageKey,
    metadata,
  });
  if (error) throw new Error(`seedConfirmacaoEntry failed: ${error.message}`);
}

async function callRpc(): Promise<Array<{ lead_id: string }>> {
  const { data, error } = await supabase.rpc('get_leads_not_confirmed', {
    p_organization_id: ORG,
    p_hours_before_meeting: HOURS_WINDOW,
    p_minutes_before_meeting: MINUTES_WINDOW,
  });
  if (error) throw new Error(`rpc failed: ${error.message}`);
  return (data ?? []) as Array<{ lead_id: string }>;
}

describe.skipIf(shouldSkip)('get_leads_not_confirmed RPC — is_confirmed signal', () => {
  beforeAll(async () => {
    const { error: orgErr } = await supabase
      .from('organizations')
      .upsert(
        { id: ORG, name: 'Not-Confirmed Test Org', slug: 'not-confirmed-test' },
        { onConflict: 'id' }
      );
    if (orgErr) throw new Error(`org seed failed: ${orgErr.message}`);

    // Fresh start: wipe fixture data from previous (possibly failed) runs.
    for (const table of ['pipeline_entries', 'lead_history', 'leads']) {
      await supabase.from(table).delete().eq('organization_id', ORG);
    }

    const { error: pipeErr } = await supabase.from('pipelines').upsert(
      {
        id: PIPELINE_CONFIRMACAO_ID,
        organization_id: ORG,
        name: 'Confirmação (fixture)',
        slug: 'confirmacao',
        type: 'system',
      },
      { onConflict: 'id' }
    );
    if (pipeErr) throw new Error(`pipeline seed failed: ${pipeErr.message}`);
  });

  afterAll(async () => {
    for (const table of [
      'pipeline_entries',
      'lead_history',
      'leads',
      'pipeline_stages',
      'pipelines',
      'organizations',
    ]) {
      const col = table === 'organizations' ? 'id' : 'organization_id';
      await supabase.from(table).delete().eq(col, ORG);
    }
  });

  it('excludes a lead flagged is_confirmed=true, includes one without the flag', async () => {
    // Confirmed on the day (real stage + real signal) → must NOT surface.
    const confirmed = await seedLead();
    await seedConfirmacaoEntry(confirmed, 'confirmacao_no_dia', true);

    // Awaiting confirmation (no flag) → must surface.
    const pending = await seedLead();
    await seedConfirmacaoEntry(pending, 'marcada', undefined);

    const rows = await callRpc();
    const ids = rows.map((r) => r.lead_id);

    expect(ids).toContain(pending);
    expect(ids).not.toContain(confirmed);
  });

  it('excludes a pre-confirmed lead still sitting in an unconfirmed stage', async () => {
    // executeConfirmMeeting(pre_confirmed) sets is_confirmed=true WITHOUT moving
    // the stage. The old dead-string clause never caught this — the flag must.
    const preConfirmed = await seedLead();
    await seedConfirmacaoEntry(preConfirmed, 'marcada', true);

    const rows = await callRpc();
    const ids = rows.map((r) => r.lead_id);

    expect(ids).not.toContain(preConfirmed);
  });
});
