/**
 * Slice 7 #40/#41 — toda RPC match_* RAG é org-scoped (Copilot v2)
 *
 * match_document_chunks/match_faqs/match_lead_memories filtravam só por
 * agent_id/lead_id (sem organization_id). Defesa-em-profundidade do projeto
 * exige predicate org em TODA query de dados de cliente. Provamos no nível
 * dos callers: nenhuma chamada match_* sai sem p_org_id (fail-CLOSED — sem
 * default no SQL, então omitir é erro).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { retrieveSemanticContext, retrieveLongTermMemories } from '../../../supabase/functions/_shared/copilot/rag.ts';
import { executeSearchKnowledge } from '../../../supabase/functions/_shared/copilot/search-knowledge.ts';

// Embeddings precisa de OPENROUTER_API_KEY; stubamos Deno.env + fetch.
const g = globalThis as any;
beforeEach(() => {
  g.Deno = { env: { get: (k: string) => (k === 'OPENROUTER_API_KEY' ? 'test-key' : undefined) } };
  g.fetch = async () => ({ ok: true, json: async () => ({ data: [{ embedding: new Array(1536).fill(0.01), index: 0 }] }) });
});

function mockSupabase() {
  const rpcCalls: Array<{ name: string; args: any }> = [];
  const rpc = async (name: string, args: any) => { rpcCalls.push({ name, args }); return { data: [], error: null }; };
  const from = () => {
    const b: any = { select: () => b, eq: () => b, then: (r: any) => r({ data: [], error: null }) };
    return b;
  };
  return { rpc, from, rpcCalls };
}

const MATCH_RPCS = ['match_document_chunks', 'match_faqs', 'match_lead_memories'];

describe('RAG match_* RPCs — org-scoped', () => {
  it('retrieveSemanticContext passes p_org_id to match_document_chunks and match_faqs', async () => {
    const sb = mockSupabase();
    await retrieveSemanticContext(sb as any, 'catálogo de aços', 'agent-1', 'org-1');
    const matchCalls = sb.rpcCalls.filter((c) => MATCH_RPCS.includes(c.name));
    expect(matchCalls.length).toBeGreaterThan(0);
    for (const c of matchCalls) expect(c.args.p_org_id).toBe('org-1');
  });

  it('retrieveLongTermMemories passes p_org_id to match_lead_memories', async () => {
    const sb = mockSupabase();
    await retrieveLongTermMemories(sb as any, 'dor do lead', 'lead-1', 'org-1');
    const c = sb.rpcCalls.find((x) => x.name === 'match_lead_memories');
    expect(c!.args.p_org_id).toBe('org-1');
  });

  it('executeSearchKnowledge passes p_org_id to every match_* call', async () => {
    const sb = mockSupabase();
    await executeSearchKnowledge(sb as any, 'tabela de preços', 'agent-1', 'org-1');
    const matchCalls = sb.rpcCalls.filter((c) => MATCH_RPCS.includes(c.name));
    expect(matchCalls.length).toBeGreaterThan(0);
    for (const c of matchCalls) expect(c.args.p_org_id).toBe('org-1');
  });
});
