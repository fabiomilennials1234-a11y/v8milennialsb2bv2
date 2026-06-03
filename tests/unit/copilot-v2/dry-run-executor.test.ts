/**
 * Slice 9 — dry-run tool executor (Copilot v2). The simulator + eval-runner feed
 * this executor to the UNCHANGED cognition spine. READ tools return a stubbed
 * snapshot; WRITE tools are recorded as "WOULD execute" and mutate NOTHING (the
 * executor never receives a supabase client, so a write is impossible by
 * construction). set_qualification_tier still runs the REAL deterministic
 * mapSignalsToTier so the trace shows the tier — without any DB write.
 */

import { describe, it, expect } from 'vitest';
import { createDryRunExecutor } from '../../../supabase/functions/_shared/copilot-v2/dry-run-executor.ts';
import type { Rubric } from '../../../supabase/functions/_shared/copilot-v2/rubric-engine.ts';

const rubric: Rubric = { rules: [{ tier: 'ouro', minFaturamento: 30000 }, { tier: 'bronze' }] };

describe('createDryRunExecutor — writes recorded, never mutate', () => {
  it('records a write tool as would_execute and returns the payload', async () => {
    const { executeTool, writes } = createDryRunExecutor({});
    const r = (await executeTool('move_lead_stage', { stage: 'proposta', pipe: 'whatsapp' })) as any;
    expect(r.would_execute).toBe(true);
    expect(r.tool).toBe('move_lead_stage');
    expect(r.args).toEqual({ stage: 'proposta', pipe: 'whatsapp' });
    expect(writes).toHaveLength(1);
    expect(writes[0].tool).toBe('move_lead_stage');
  });

  it('records send_media without any provider/signed-url call (by construction)', async () => {
    const { executeTool, writes } = createDryRunExecutor({});
    const r = (await executeTool('send_media', { media_id: 'm1' })) as any;
    expect(r.would_execute).toBe(true);
    expect(writes.map((w) => w.tool)).toContain('send_media');
  });
});

describe('createDryRunExecutor — reads return the stubbed snapshot', () => {
  it('list_pipeline_stages returns the seeded stages', async () => {
    const { executeTool, writes } = createDryRunExecutor({ snapshot: { stages: ['novo', 'proposta'] } });
    const r = (await executeTool('list_pipeline_stages', {})) as any;
    expect(r.stages).toEqual(['novo', 'proposta']);
    expect(writes).toHaveLength(0); // a read is never recorded as a write
  });

  it('get_contact_status returns the seeded status (default NOVO)', async () => {
    const { executeTool } = createDryRunExecutor({ snapshot: { contactStatus: 'QUALIFIED' } });
    expect(((await executeTool('get_contact_status', {})) as any).status).toBe('QUALIFIED');
    const def = createDryRunExecutor({});
    expect(((await def.executeTool('get_contact_status', {})) as any).status).toBe('NOVO');
  });

  it('honest empty defaults for unseeded reads', async () => {
    const { executeTool } = createDryRunExecutor({});
    expect(((await executeTool('list_custom_fields', {})) as any).fields).toEqual([]);
  });
});

describe('createDryRunExecutor — set_qualification_tier runs the real rubric, no write', () => {
  it('computes the tier deterministically and records it', async () => {
    const { executeTool, writes } = createDryRunExecutor({ rubric });
    const r = (await executeTool('set_qualification_tier', { signals: { faturamentoMensal: 50000 } })) as any;
    expect(r.would_execute).toBe(true);
    expect(r.applied).toBe(true);
    expect(r.tier).toBe('ouro');
    expect(writes[0].tier).toBe('ouro');
  });

  it('falls to desqualificado when no rule is satisfied', async () => {
    const { executeTool } = createDryRunExecutor({ rubric });
    const r = (await executeTool('set_qualification_tier', { signals: { faturamentoMensal: 100 } })) as any;
    expect(r.tier).toBe('bronze'); // bronze rule has no floor → always satisfied
  });

  it('with no rubric, reports no_rubric and does not throw', async () => {
    const { executeTool } = createDryRunExecutor({});
    const r = (await executeTool('set_qualification_tier', { signals: {} })) as any;
    expect(r.applied).toBe(false);
    expect(r.tier).toBeNull();
  });
});

describe('createDryRunExecutor — unknown tool', () => {
  it('records an unknown tool as a would_execute write (gate already blocks it upstream)', async () => {
    const { executeTool } = createDryRunExecutor({});
    const r = (await executeTool('drop_database', {})) as any;
    expect(r.would_execute).toBe(true);
  });
});
