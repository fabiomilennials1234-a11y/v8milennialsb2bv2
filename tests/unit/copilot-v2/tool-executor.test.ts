/**
 * Slice 3 — tool-executor dispatch + multi-tenant invariant (Copilot v2)
 *
 * Tested with a query-recording mock Supabase (no DB): dispatch (unknown vs
 * not_implemented), the 3 unblocked read handlers' query shape, and the core
 * invariant — organization_id ALWAYS comes from ctx, NEVER from the LLM args.
 */

import { describe, it, expect } from 'vitest';
import { createToolExecutor, ToolError, type ToolContext } from '../../../supabase/functions/_shared/copilot-v2/tool-executor.ts';

function mockSupabase(results: Record<string, unknown> = {}) {
  const queries: Array<{ table: string; filters: [string, unknown][]; order: unknown; limit: unknown }> = [];
  const from = (table: string) => {
    const q = { table, filters: [] as [string, unknown][], order: null as unknown, limit: null as unknown };
    queries.push(q);
    const b: any = {
      select: () => b,
      update: (vals: unknown) => { (q as any).update = vals; return b; },
      upsert: (vals: unknown, opts: unknown) => { (q as any).upsert = vals; (q as any).onConflict = opts; return b; },
      eq: (c: string, v: unknown) => { q.filters.push([c, v]); return b; },
      is: (c: string, v: unknown) => { q.filters.push([c, v]); return b; },
      order: (c: string, o: unknown) => { q.order = [c, o]; return b; },
      limit: (n: number) => { q.limit = n; return b; },
      maybeSingle: () => Promise.resolve({ data: results[table] ?? null, error: null }),
      then: (resolve: (r: unknown) => unknown) => resolve({ data: results[table] ?? [], error: null }),
    };
    return b;
  };
  const rpcCalls: Array<{ name: string; args: any }> = [];
  const rpc = async (name: string, args: any) => {
    rpcCalls.push({ name, args });
    return { data: (results as any)[`rpc:${name}`] ?? null, error: (results as any)[`rpcError:${name}`] ?? null };
  };
  return { from, rpc, queries, rpcCalls };
}

const ctx: ToolContext = { organizationId: 'org-1', leadId: 'lead-1', conversationId: 'conv-1' };

describe('createToolExecutor — dispatch', () => {
  it('throws unknown_tool for a tool not in the registry', async () => {
    const exec = createToolExecutor(mockSupabase(), ctx);
    await expect(exec('drop_database', {})).rejects.toMatchObject({ code: 'unknown_tool' });
  });

  it('throws not_implemented for a registered tool whose handler is not built yet', async () => {
    const exec = createToolExecutor(mockSupabase(), ctx);
    // send_media is in the registry but backed by a later-slice table.
    await expect(exec('send_media', {})).rejects.toBeInstanceOf(ToolError);
    await expect(exec('send_media', {})).rejects.toMatchObject({ code: 'not_implemented' });
  });
});

describe('get_lead_360', () => {
  it('queries leads filtered by org + id and returns the row', async () => {
    const sb = mockSupabase({ leads: { id: 'lead-1', name: 'Aços Brasil' } });
    const out = await createToolExecutor(sb, ctx)('get_lead_360', {});
    expect(out).toMatchObject({ id: 'lead-1' });
    const q = sb.queries.find((x) => x.table === 'leads')!;
    expect(q.filters).toContainEqual(['organization_id', 'org-1']);
    expect(q.filters).toContainEqual(['id', 'lead-1']);
  });

  it('falls back to normalized_phone when no leadId is in context', async () => {
    const sb = mockSupabase({ leads: { id: 'l2' } });
    const exec = createToolExecutor(sb, { organizationId: 'org-1', canonicalPhone: '11987654321' });
    await exec('get_lead_360', {});
    const q = sb.queries.find((x) => x.table === 'leads')!;
    expect(q.filters).toContainEqual(['normalized_phone', '11987654321']);
  });

  it('IGNORES an organization_id passed in args — org comes only from ctx', async () => {
    const sb = mockSupabase({ leads: { id: 'lead-1' } });
    await createToolExecutor(sb, ctx)('get_lead_360', { organization_id: 'EVIL-ORG' });
    const q = sb.queries.find((x) => x.table === 'leads')!;
    expect(q.filters).toContainEqual(['organization_id', 'org-1']);
    expect(q.filters).not.toContainEqual(['organization_id', 'EVIL-ORG']);
  });
});

describe('list_pipeline_stages', () => {
  it('queries active stages of the org, filtered by pipe (resolvido via adapter → pipeline_id), ordered by position', async () => {
    const sb = mockSupabase({
      pipelines: { id: 'pipe-wpp', slug: 'whatsapp', name: 'WhatsApp', type: 'system', is_active: true },
      pipeline_stages: [{ stage_key: 'novo_lead', position: 0 }],
    });
    const out = await createToolExecutor(sb, ctx)('list_pipeline_stages', { pipe: 'whatsapp' });
    expect(out).toEqual([{ stage_key: 'novo_lead', position: 0 }]);
    const q = sb.queries.find((x) => x.table === 'pipeline_stages')!;
    expect(q.filters).toContainEqual(['organization_id', 'org-1']);
    expect(q.filters).toContainEqual(['is_active', true]);
    // SCRUM-628: o filtro por funil é pelo pipeline_id REAL (cobre funil
    // custom, cujo pipeline_type é NULL) — não mais por pipeline_type.
    expect(q.filters).toContainEqual(['pipeline_id', 'pipe-wpp']);
    expect(q.order).toEqual(['position', { ascending: true }]);
  });

  it('sem filtro de pipe lista as etapas da org inteira (sem resolver funil)', async () => {
    const sb = mockSupabase({ pipeline_stages: [{ stage_key: 'x', position: 0 }] });
    const out = await createToolExecutor(sb, ctx)('list_pipeline_stages', {});
    expect(out).toEqual([{ stage_key: 'x', position: 0 }]);
    expect(sb.queries.some((x) => x.table === 'pipelines')).toBe(false);
  });
});

describe('move_lead_stage (write) — SCRUM-628: qualquer funil, via pipeline_entries', () => {
  const baseResults = () => ({
    pipelines: { id: 'pipe-wpp', slug: 'whatsapp', name: 'WhatsApp', type: 'system', is_active: true },
    pipeline_stages: [
      { id: 'st-novo', stage_key: 'novo', name: 'Novo' },
      { id: 'st-abordado', stage_key: 'abordado', name: 'Abordado' },
    ],
    pipeline_entries: [
      { id: 'entry-1', pipeline_id: 'pipe-wpp', lead_id: 'lead-1', stage_key: 'novo', closed_at: null, metadata: {} },
    ],
  });

  it('moves the current entry via pipeline_entries (nunca as views pipe_*)', async () => {
    const sb = mockSupabase(baseResults());
    const out = await createToolExecutor(sb, ctx)('move_lead_stage', { pipe: 'whatsapp', stage: 'abordado' });
    expect(out).toMatchObject({ moved: true, pipe: 'whatsapp', stage: 'abordado', entry_id: 'entry-1' });
    const upd = sb.queries.find((x) => x.table === 'pipeline_entries' && (x as any).update)!;
    expect((upd as any).update).toMatchObject({ stage_key: 'abordado' });
    expect(upd.filters).toContainEqual(['id', 'entry-1']);
    expect(sb.queries.some((x) => x.table === 'pipe_whatsapp')).toBe(false);
  });

  it('never takes org from args on a write', async () => {
    const sb = mockSupabase(baseResults());
    await createToolExecutor(sb, ctx)('move_lead_stage', { pipe: 'whatsapp', stage: 'abordado', organization_id: 'EVIL' });
    const stagesQ = sb.queries.find((x) => x.table === 'pipeline_stages')!;
    expect(stagesQ.filters).toContainEqual(['organization_id', 'org-1']);
    expect(stagesQ.filters).not.toContainEqual(['organization_id', 'EVIL']);
  });

  it('erro tipado do adapter vira ToolError claro (funil inexistente)', async () => {
    const exec = createToolExecutor(mockSupabase(), ctx);
    await expect(exec('move_lead_stage', { pipe: 'funil-que-nao-existe', stage: 's' }))
      .rejects.toMatchObject({ code: 'pipeline_not_found' });
  });

  it('funil custom resolve por slug/uuid e move igual (não é mais not_implemented)', async () => {
    const sb = mockSupabase({
      pipelines: { id: 'pipe-custom', slug: 'pos-venda', name: 'Pós-venda', type: 'custom', is_active: true },
      pipeline_stages: [{ id: 'cs-1', stage_key: 'entrada', name: 'Entrada' }],
      pipeline_entries: [
        { id: 'entry-c', pipeline_id: 'pipe-custom', lead_id: 'lead-1', stage_key: 'outra', closed_at: null, metadata: {} },
      ],
    });
    const out = await createToolExecutor(sb, ctx)('move_lead_stage', { pipe: 'pos-venda', stage: 'entrada' });
    expect(out).toMatchObject({ moved: true, pipe: 'pos-venda', stage: 'entrada' });
  });

  it('etapa que não existe no funil → ToolError stage_not_found', async () => {
    const sb = mockSupabase(baseResults());
    await expect(createToolExecutor(sb, ctx)('move_lead_stage', { pipe: 'whatsapp', stage: 'fantasma' }))
      .rejects.toMatchObject({ code: 'stage_not_found' });
  });

  it('lead sem negócio no funil → não cria (ADR-0023 §3), devolve estado honesto', async () => {
    const sb = mockSupabase({ ...baseResults(), pipeline_entries: [] });
    const out = await createToolExecutor(sb, ctx)('move_lead_stage', { pipe: 'whatsapp', stage: 'abordado' });
    expect(out).toMatchObject({ moved: false, reason: 'lead_sem_negocio_no_funil' });
    expect(sb.queries.some((x) => x.table === 'pipeline_entries' && (x as any).update)).toBe(false);
    expect(sb.queries.some((x) => (x as any).upsert)).toBe(false);
  });
});

describe('set_qualification_tier (rubric-driven write)', () => {
  const tierCtx: ToolContext = { organizationId: 'org-1', leadId: 'lead-1', agentId: 'agent-1' };
  const rubricRow = { rules: [{ tier: 'ouro', minFaturamento: 300_000, requiresIcp: true }] };

  it('runs the deterministic rubric on the signals and writes leads.qualification_tier', async () => {
    const sb = mockSupabase({ copilot_v2_rubric: rubricRow });
    const out = await createToolExecutor(sb, tierCtx)('set_qualification_tier', {
      signals: { faturamentoMensal: 500_000, icpFit: true },
    });
    expect(out).toMatchObject({ applied: true, tier: 'ouro' });
    const leadsUpdate = sb.queries.find((x) => x.table === 'leads')!;
    expect((leadsUpdate as any).update).toMatchObject({ qualification_tier: 'ouro' });
    expect(leadsUpdate.filters).toContainEqual(['organization_id', 'org-1']);
    expect(leadsUpdate.filters).toContainEqual(['id', 'lead-1']);
  });

  it('does NOT write when no rubric is configured (honest no-op)', async () => {
    const sb = mockSupabase({}); // no copilot_v2_rubric row
    const out = await createToolExecutor(sb, tierCtx)('set_qualification_tier', { signals: {} });
    expect(out).toMatchObject({ applied: false, reason: 'no_rubric' });
    expect(sb.queries.some((x) => x.table === 'leads')).toBe(false);
  });

  it('requires the agent in context (needs the rubric)', async () => {
    const exec = createToolExecutor(mockSupabase(), { organizationId: 'org-1', leadId: 'lead-1' });
    await expect(exec('set_qualification_tier', { signals: {} })).rejects.toMatchObject({ code: 'missing_context' });
  });
});

describe('get_contact_status', () => {
  it('returns NOVO when no lead exists', async () => {
    const out = await createToolExecutor(mockSupabase({}), { organizationId: 'org-1', canonicalPhone: '11987654321' })('get_contact_status', {});
    expect(out).toMatchObject({ status: 'NOVO' });
  });

  it('returns CLIENTE_CARTEIRA when the lead is in upsell_clients', async () => {
    const sb = mockSupabase({ leads: { id: 'lead-1', qualification_tier: null }, upsell_clients: { id: 'uc-1' } });
    const out = await createToolExecutor(sb, ctx)('get_contact_status', {});
    expect(out).toMatchObject({ status: 'CLIENTE_CARTEIRA', leadId: 'lead-1' });
  });

  it('returns QUALIFIED when the lead has a qualifying tier and is not in the portfolio', async () => {
    const sb = mockSupabase({ leads: { id: 'lead-1', qualification_tier: 'ouro' } });
    const out = await createToolExecutor(sb, ctx)('get_contact_status', {});
    expect(out).toMatchObject({ status: 'QUALIFIED' });
  });

  it('returns LEAD_NO_PIPELINE for a known lead with no tier and no portfolio', async () => {
    const sb = mockSupabase({ leads: { id: 'lead-1', qualification_tier: null } });
    const out = await createToolExecutor(sb, ctx)('get_contact_status', {});
    expect(out).toMatchObject({ status: 'LEAD_NO_PIPELINE' });
  });
});

describe('list_custom_fields', () => {
  it('returns the org custom field definitions (real lead_custom_fields table)', async () => {
    const sb = mockSupabase({ lead_custom_fields: [{ field_name: 'cnpj', field_type: 'text', is_required: true }] });
    const out = await createToolExecutor(sb, ctx)('list_custom_fields', {});
    expect(out).toEqual([{ field: 'cnpj', type: 'text', required: true }]);
    const q = sb.queries.find((x) => x.table === 'lead_custom_fields')!;
    expect(q.filters).toContainEqual(['organization_id', 'org-1']);
  });
});

describe('fill_lead_field (custom value upsert)', () => {
  it('resolves the field def and upserts the value (unique lead_id+field_id)', async () => {
    const sb = mockSupabase({ lead_custom_fields: { id: 'field-1' } });
    const out = await createToolExecutor(sb, ctx)('fill_lead_field', { field: 'cnpj', value: '12.345.678/0001-00' });
    expect(out).toMatchObject({ filled: true, field: 'cnpj' });
    const defQ = sb.queries.find((x) => x.table === 'lead_custom_fields')!;
    expect(defQ.filters).toContainEqual(['organization_id', 'org-1']);
    const valQ = sb.queries.find((x) => x.table === 'lead_custom_field_values')!;
    expect((valQ as any).upsert).toMatchObject({ lead_id: 'lead-1', field_id: 'field-1', value: '12.345.678/0001-00' });
    expect((valQ as any).onConflict).toMatchObject({ onConflict: 'lead_id,field_id' });
  });

  it('does not write when the field is not defined for the org (honest no-op)', async () => {
    const sb = mockSupabase({}); // no lead_custom_fields row
    const out = await createToolExecutor(sb, ctx)('fill_lead_field', { field: 'inexistente', value: 'x' });
    expect(out).toMatchObject({ filled: false, reason: 'unknown_field' });
    expect(sb.queries.some((x) => x.table === 'lead_custom_field_values')).toBe(false);
  });

  it('requires a lead in context', async () => {
    const exec = createToolExecutor(mockSupabase(), { organizationId: 'org-1' });
    await expect(exec('fill_lead_field', { field: 'cnpj', value: 'x' })).rejects.toMatchObject({ code: 'missing_context' });
  });
});

describe('transfer_to_human', () => {
  it('pauses the agent phone-keyed and returns a structured handoff payload', async () => {
    const sb = mockSupabase({});
    const out: any = await createToolExecutor(sb, { organizationId: 'org-1', leadId: 'lead-1', canonicalPhone: '11987654321' })(
      'transfer_to_human', { reason: 'pediu humano', summary: 'lead quer falar com vendedor' },
    );
    expect(out).toMatchObject({ transferred: true, reason: 'pediu humano' });
    expect(out.handoff).toMatchObject({ leadId: 'lead-1', reason: 'pediu humano' });
    const pause = sb.rpcCalls.find((c) => c.name === 'copilot_v2_set_human_pause')!;
    expect(pause.args).toMatchObject({ p_org_id: 'org-1', p_canonical_phone: '11987654321' });
  });

  it('requires the canonical phone (the pause key)', async () => {
    const exec = createToolExecutor(mockSupabase({}), { organizationId: 'org-1', leadId: 'lead-1' });
    await expect(exec('transfer_to_human', { reason: 'x' })).rejects.toMatchObject({ code: 'missing_context' });
  });
});

describe('get_conversation_history', () => {
  it('queries conversation_messages for the context conversation', async () => {
    const sb = mockSupabase({ conversation_messages: [{ role: 'user', content: 'oi' }] });
    const out = await createToolExecutor(sb, ctx)('get_conversation_history', { limit: 10 });
    expect(out).toEqual([{ role: 'user', content: 'oi' }]);
    const q = sb.queries.find((x) => x.table === 'conversation_messages')!;
    expect(q.filters).toContainEqual(['conversation_id', 'conv-1']);
    expect(q.limit).toBe(10);
  });
});
