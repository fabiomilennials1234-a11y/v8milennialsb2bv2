/**
 * Slice 6 — catálogo send-media é ORG-LEVEL: trocar o acervo na org reflete nos
 * 3 arquétipos (Copilot v2). O item é resolvido por organization_id + id, nunca
 * por agent_id — então Qualificador, Vendedor e Carteira da MESMA org veem o
 * mesmo catálogo (sem a duplicação per-agent da v1).
 */
import { describe, it, expect } from 'vitest';
import { createToolExecutor } from '../../../supabase/functions/_shared/copilot-v2/tool-executor.ts';

function mockSupabase(row: any) {
  const queries: any[] = [];
  const from = (table: string) => {
    const q: any = { table, filters: [] as [string, unknown][] };
    queries.push(q);
    const b: any = {
      select: () => b, eq: (c: string, v: unknown) => { q.filters.push([c, v]); return b; },
      maybeSingle: () => Promise.resolve({ data: table === 'copilot_v2_send_media' ? row : null, error: null }),
      then: (r: any) => r({ data: [], error: null }),
    };
    return b;
  };
  const storage = { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'u' }, error: null }) }) };
  return { from, storage, queries };
}

const item = { id: 'm1', organization_id: 'org-1', kind: 'image', storage_path: 'org-1/x.png', is_active: true, mime_type: 'image/png' };

describe('send-media catálogo org-level (3 arquétipos, 1 acervo)', () => {
  for (const agentId of ['agent-qualificador', 'agent-vendedor', 'agent-carteira']) {
    it(`${agentId} resolve o MESMO item por organization_id (não por agent)`, async () => {
      const sb = mockSupabase(item);
      const sent: any[] = [];
      const exec = createToolExecutor(sb, {
        organizationId: 'org-1', leadId: 'l1', conversationId: 'c1', canonicalPhone: '11987654321', agentId,
        sendMediaViaProvider: async (p: any) => { sent.push(p); return { success: true, message_id: 'w1' }; },
      } as any);
      const out: any = await exec('send_media', { media_id: 'm1' });
      expect(out).toMatchObject({ sent: true, media_id: 'm1' });
      const q = sb.queries.find((x: any) => x.table === 'copilot_v2_send_media')!;
      expect(q.filters).toContainEqual(['organization_id', 'org-1']);
      expect(q.filters).not.toContainEqual(['agent_id', agentId]); // org-level, não per-agent
    });
  }
});
