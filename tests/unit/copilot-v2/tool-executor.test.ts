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
      eq: (c: string, v: unknown) => { q.filters.push([c, v]); return b; },
      is: (c: string, v: unknown) => { q.filters.push([c, v]); return b; },
      order: (c: string, o: unknown) => { q.order = [c, o]; return b; },
      limit: (n: number) => { q.limit = n; return b; },
      maybeSingle: () => Promise.resolve({ data: results[table] ?? null, error: null }),
      then: (resolve: (r: unknown) => unknown) => resolve({ data: results[table] ?? [], error: null }),
    };
    return b;
  };
  return { from, queries };
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
  it('queries active stages of the org, filtered by pipe, ordered by position', async () => {
    const sb = mockSupabase({ pipeline_stages: [{ stage_key: 'novo_lead', position: 0 }] });
    const out = await createToolExecutor(sb, ctx)('list_pipeline_stages', { pipe: 'whatsapp' });
    expect(out).toEqual([{ stage_key: 'novo_lead', position: 0 }]);
    const q = sb.queries.find((x) => x.table === 'pipeline_stages')!;
    expect(q.filters).toContainEqual(['organization_id', 'org-1']);
    expect(q.filters).toContainEqual(['is_active', true]);
    expect(q.filters).toContainEqual(['pipeline_type', 'whatsapp']);
    expect(q.order).toEqual(['position', { ascending: true }]);
  });
});

describe('move_lead_stage (write)', () => {
  it('updates the system pipe status filtered by org + lead', async () => {
    const sb = mockSupabase();
    const out = await createToolExecutor(sb, ctx)('move_lead_stage', { pipe: 'whatsapp', stage: 'abordado' });
    expect(out).toEqual({ moved: true, pipe: 'whatsapp', stage: 'abordado' });
    const q = sb.queries.find((x) => x.table === 'pipe_whatsapp')!;
    expect((q as any).update).toMatchObject({ status: 'abordado' });
    expect(q.filters).toContainEqual(['organization_id', 'org-1']);
    expect(q.filters).toContainEqual(['lead_id', 'lead-1']);
  });

  it('never takes org from args on a write', async () => {
    const sb = mockSupabase();
    await createToolExecutor(sb, ctx)('move_lead_stage', { pipe: 'confirmacao', stage: 'd1', organization_id: 'EVIL' });
    const q = sb.queries.find((x) => x.table === 'pipe_confirmacao')!;
    expect(q.filters).toContainEqual(['organization_id', 'org-1']);
    expect(q.filters).not.toContainEqual(['organization_id', 'EVIL']);
  });

  it('throws not_implemented for a custom pipe (stored differently — later slice)', async () => {
    const exec = createToolExecutor(mockSupabase(), ctx);
    await expect(exec('move_lead_stage', { pipe: 'custom-xyz', stage: 's' })).rejects.toMatchObject({ code: 'not_implemented' });
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
