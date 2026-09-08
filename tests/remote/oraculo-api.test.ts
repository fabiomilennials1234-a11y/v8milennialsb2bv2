/** Real PostgREST/RLS validation. Run only against a disposable, empty branch. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { alvoRemoto, chaveRemota } from './guard';

const url = alvoRemoto();
const options = () => ({ auth: { persistSession: false, autoRefreshToken: false, storageKey: crypto.randomUUID() } });
const service = createClient(url, chaveRemota(), options());
const anonKey = process.env.TEST_SUPABASE_ANON_KEY;
if (!anonKey) throw new Error('TEST_SUPABASE_ANON_KEY required');
const anon = createClient(url, anonKey, options());
const orgA = crypto.randomUUID(), orgB = crypto.randomUUID();
const users: string[] = [];
let owner: SupabaseClient, stranger: SupabaseClient;
let conversationId: string;
const result = { text: 'Resposta auditável', toolsUsed: ['metricas'], rejectedToolCalls: [],
  hitToolCeiling: false, telemetry: { model: 'fixture', inputTokens: 12, outputTokens: 8, latencyMs: 100 } };
const call = (overrides = {}) => ({ p_conversation_id: conversationId, p_organization_id: orgA,
  p_user_id: users[0], p_expected_last_message_at: null, p_question: 'Pergunta sintética',
  p_result: result, p_summary: 'Resumo sintético', ...overrides });
async function checked<T extends { error: unknown }>(request: PromiseLike<T>): Promise<T> {
  const response = await request;
  if (response.error) throw response.error;
  return response;
}
async function history(client: SupabaseClient, id = conversationId) {
  return (await checked(client.from('oraculo_turns').select('*').eq('conversation_id', id).order('created_at'))).data!;
}

beforeAll(async () => {
  await checked(service.from('organizations').insert([
    { id: orgA, name: 'Oracle QA A', slug: `oracle-${orgA}`, subscription_status: 'active' },
    { id: orgB, name: 'Oracle QA B', slug: `oracle-${orgB}`, subscription_status: 'active' },
  ]));
  await checked(service.from('org_quotas').upsert([
    { organization_id: orgA, resource_key: 'max_users', plan_base: 5 },
    { organization_id: orgB, resource_key: 'max_users', plan_base: 5 },
  ], { onConflict: 'organization_id,resource_key' }));
  for (let i = 0; i < 2; i++) {
    const email = `oracle-${crypto.randomUUID()}@example.test`, password = crypto.randomUUID() + '!Aa9';
    const { data } = await checked(service.auth.admin.createUser({ email, password, email_confirm: true }));
    users.push(data.user!.id);
    const client = createClient(url, anonKey!, options());
    await checked(client.auth.signInWithPassword({ email, password }));
    if (i === 0) owner = client; else stranger = client;
  }
  await checked(service.from('team_members').insert([
    { user_id: users[0], organization_id: orgA, name: 'Owner A', role: 'admin' },
    { user_id: users[0], organization_id: orgB, name: 'Owner B', role: 'admin' },
    { user_id: users[1], organization_id: orgA, name: 'Stranger', role: 'admin' },
  ]));
}, 60_000);

afterAll(async () => {
  // Only synthetic rows owned by this run. The caller also deletes the disposable branch.
  await checked(service.from('oraculo_conversations').delete().in('organization_id', [orgA, orgB]));
  await checked(service.from('team_members').delete().in('organization_id', [orgA, orgB]));
  // Org deletion currently trips an inherited queue FK trigger. Branch teardown removes orgs.
  for (const id of users) await checked(service.auth.admin.deleteUser(id));
}, 60_000);

describe.sequential('Oráculo real — RPC e histórico', () => {
  beforeAll(async () => {
    const { data } = await checked(service.from('oraculo_conversations').insert({
      organization_id: orgA, user_id: users[0],
    }).select('id').single());
    conversationId = data!.id;
  });

  it('nega execução anon e authenticated, mesmo sendo dono', async () => {
    for (const client of [anon, owner]) {
      const response = await client.rpc('oraculo_save_turn', call());
      expect(response.error?.code).toBe('42501');
    }
    expect(await history(service)).toHaveLength(0);
  });

  it('service role não grava com organização ou proprietário trocado', async () => {
    for (const override of [{ p_organization_id: orgB }, { p_user_id: users[1] }]) {
      const response = await service.rpc('oraculo_save_turn', call(override));
      expect(response.error?.code).toBe('42501');
    }
    expect(await history(service)).toHaveLength(0);
  });

  it('falha na segunda linha desfaz a pergunta e não altera resumo', async () => {
    const response = await service.rpc('oraculo_save_turn', call({ p_result: { ...result, text: null } }));
    expect(response.error?.code).toBe('23502');
    expect(await history(owner)).toHaveLength(0);
    const { data } = await checked(owner.from('oraculo_conversations').select('summary,last_message_at').eq('id', conversationId).single());
    expect(data).toEqual({ summary: null, last_message_at: null });
  });

  it('falha após inserir as duas linhas desfaz turno inteiro e resumo', async () => {
    // Prerequisite: supabase/qa-seed/oraculo-rollback.sql on the disposable branch.
    const response = await service.rpc('oraculo_save_turn', call({ p_summary: '__qa_oraculo_fail_summary__' }));
    expect(response.error?.code).toBe('P0001');
    expect(await history(owner)).toHaveLength(0);
    const { data } = await checked(owner.from('oraculo_conversations').select('summary,last_message_at').eq('id', conversationId).single());
    expect(data).toEqual({ summary: null, last_message_at: null });
  });

  it('dois pedidos concorrentes confirmam somente um par e preservam metadados', async () => {
    const request = () => fetch(`${url}/rest/v1/rpc/oraculo_save_turn`, {
      method: 'POST', headers: { apikey: chaveRemota(), Authorization: `Bearer ${chaveRemota()}`,
        'Content-Type': 'application/json' }, body: JSON.stringify(call()), signal: AbortSignal.timeout(20_000),
    });
    const responses = await Promise.all([request(), request()]);
    expect(responses.filter(r => r.ok)).toHaveLength(1);
    expect(responses.find(r => !r.ok)!.status).toBe(409);
    expect((await responses.find(r => !r.ok)!.json()).code).toBe('PT409');
    const turns = await history(owner);
    expect(turns.map(t => t.role)).toEqual(['user', 'assistant']);
    expect(turns[1]).toMatchObject({ content: result.text, tools_used: ['metricas'], input_tokens: 12, output_tokens: 8, latency_ms: 100 });
    expect(turns[0].created_at < turns[1].created_at).toBe(true);
  }, 30_000);

  it('continua a conversa com versão exata do histórico sem perder precisão', async () => {
    const snapshot = await checked(owner.from('oraculo_conversations').select('last_message_at,summary').eq('id', conversationId).single());
    expect(snapshot.data!.summary).toBe('Resumo sintético');
    await checked(service.rpc('oraculo_save_turn', call({
      p_expected_last_message_at: snapshot.data!.last_message_at,
      p_question: 'Segunda pergunta', p_summary: 'Resumo atualizado',
    })));
    const turns = await history(owner);
    expect(turns.map(t => t.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(turns[2].content).toBe('Segunda pergunta');
    const updated = await checked(owner.from('oraculo_conversations').select('last_message_at,summary').eq('id', conversationId).single());
    expect(updated.data!.summary).toBe('Resumo atualizado');
    expect(updated.data!.last_message_at > snapshot.data!.last_message_at).toBe(true);
  });

  it('nega leitura por outra pessoa e escrita direta pelo dono', async () => {
    expect(await history(stranger)).toEqual([]);
    const { data } = await checked(stranger.from('oraculo_conversations').select('id').eq('id', conversationId));
    expect(data).toEqual([]);
    const response = await owner.from('oraculo_turns').insert({ conversation_id: conversationId,
      organization_id: orgA, user_id: users[0], role: 'assistant', content: 'forjado' });
    expect(response.error?.code).toBe('42501');
  });

  it('revogação em A remove histórico de A e preserva acesso legítimo em B', async () => {
    const { data } = await checked(service.from('oraculo_conversations').insert({ organization_id: orgB, user_id: users[0] }).select('id').single());
    await checked(service.rpc('oraculo_save_turn', call({ p_conversation_id: data!.id, p_organization_id: orgB })));
    await checked(service.from('team_members').update({ is_active: false }).eq('user_id', users[0]).eq('organization_id', orgA));
    expect(await history(owner)).toEqual([]);
    const conversations = await checked(owner.from('oraculo_conversations').select('id').eq('id', conversationId));
    expect(conversations.data).toEqual([]);
    expect(await history(owner, data!.id)).toHaveLength(2);
  });
});
