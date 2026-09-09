/** Public hook and external HTTP boundary; real Supabase SDK and QueryClient. */
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useOraculoTurno } from './useOraculoTurno';

const ORG = '20000000-0000-4000-8000-000000000001';
let requests: Record<string, unknown>[];
let actionRequests: Record<string, unknown>[];
let reply: () => Response | Promise<Response>;
let actionReply: () => Response | Promise<Response>;
const success = () => Response.json({ conversa_id: 'c-1', resposta: 'Você fechou 3 vendas.',
  procedencia: ['metricas'], restantes_hoje: 24, propostas: [{
    kind: 'oraculo_action_proposal', id: '30000000-0000-4000-8000-000000000001',
    acao: 'adicionar_tag', criterio: { tipo: 'leads_parados', dias: 14 },
    parametros: { tag_id: 'tag-1' }, previsao: 5, status: 'pending',
  }] });
const wrap = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};
beforeEach(() => {
  requests = []; actionRequests = []; reply = success;
  actionReply = () => Response.json({ status: 'sucesso', previstos: 5, qualificaveis_no_clique: 3, alterados: 3, ja_tratados: 2 });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url.endsWith('/functions/v1/oraculo-action')) {
      actionRequests.push(await request.json());
      return actionReply();
    }
    if (!request.url.endsWith('/functions/v1/oraculo-turno')) throw new Error('Unexpected external request');
    requests.push(await request.json());
    return reply();
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Oráculo — contrato HTTP do navegador', () => {
  it('envia organização ativa e mostra resposta com procedência', async () => {
    const { result } = renderHook(() => useOraculoTurno(ORG), { wrapper: wrap() });
    act(() => result.current.perguntar('Quantas vendas?'));
    expect(result.current.mensagens.map(m => m.content)).toEqual(['Quantas vendas?']);
    await waitFor(() => expect(result.current.mensagens).toHaveLength(2));
    expect(requests).toEqual([{ organization_id: ORG, pergunta: 'Quantas vendas?', conversa_id: null }]);
    expect(result.current.mensagens[1]).toMatchObject({ content: 'Você fechou 3 vendas.', procedencia: ['metricas'] });
    expect(result.current.mensagens[1].propostas?.[0]).toMatchObject({ previsao: 5, status: 'pending' });
  });

  it('confirma proposta em requisição separada e mostra o resultado real', async () => {
    const { result } = renderHook(() => useOraculoTurno(ORG), { wrapper: wrap() });
    act(() => result.current.perguntar('Marque os parados como prioridade'));
    await waitFor(() => expect(result.current.mensagens).toHaveLength(2));

    act(() => result.current.executarProposta('30000000-0000-4000-8000-000000000001'));
    await waitFor(() => expect(result.current.mensagens[1].propostas?.[0].status).toBe('executed'));

    expect(actionRequests).toEqual([{
      organization_id: ORG,
      proposta_id: '30000000-0000-4000-8000-000000000001',
    }]);
    expect(result.current.mensagens[1].propostas?.[0].resultado).toMatchObject({ alterados: 3, ja_tratados: 2 });
  });

  it('não apresenta falha técnica como recusa de permissão', async () => {
    actionReply = () => Response.json({ error: 'falha_interna' }, { status: 500 });
    const { result } = renderHook(() => useOraculoTurno(ORG), { wrapper: wrap() });
    act(() => result.current.perguntar('Marque os parados como prioridade'));
    await waitFor(() => expect(result.current.mensagens).toHaveLength(2));

    act(() => result.current.executarProposta('30000000-0000-4000-8000-000000000001'));
    await waitFor(() => expect(result.current.mensagens[1].propostas?.[0].erro).toContain('Tente de novo'));
    expect(result.current.mensagens[1].propostas?.[0].erro).not.toContain('permissão');
  });
});

it('sem organização não envia pergunta nem cria mensagem otimista', async () => {
  const { result } = renderHook(() => useOraculoTurno(null), { wrapper: wrap() });
  act(() => result.current.perguntar('Quantas vendas?'));
  await waitFor(() => expect(result.current.erro).toContain('organização'));
  expect(requests).toEqual([]);
  expect(result.current.mensagens).toEqual([]);
});

it.each([
  [403, 'acesso'], [409, 'outra resposta'], [429, 'limite'],
])('HTTP %i explica recusa sem fabricar resposta', async (status, message) => {
  reply = () => Response.json({ error: 'recusado' }, { status: status as number });
  const { result } = renderHook(() => useOraculoTurno(ORG), { wrapper: wrap() });
  act(() => result.current.perguntar('Quantas vendas?'));
  await waitFor(() => expect(result.current.erro).toContain(message));
  expect(result.current.mensagens.filter(m => m.role === 'assistant')).toEqual([]);
});

it('resposta atrasada não entra na conversa aberta depois', async () => {
  let finish!: (response: Response) => void;
  reply = () => new Promise(resolve => { finish = resolve; });
  const { result } = renderHook(() => useOraculoTurno(ORG), { wrapper: wrap() });
  act(() => result.current.perguntar('Pergunta antiga'));
  await waitFor(() => expect(requests).toHaveLength(1));
  act(() => result.current.abrirConversa('outra', []));
  await act(async () => { finish(success()); });
  await waitFor(() => expect(result.current.pensando).toBe(false));
  expect(result.current.conversaId).toBe('outra');
  expect(result.current.mensagens).toEqual([]);
});

it('continuação mantém mensagens recuperadas no histórico visível', async () => {
  const saved = [{ id: 'saved', role: 'assistant' as const, content: 'Contexto anterior', criadaEm: new Date() }];
  const { result } = renderHook(() => useOraculoTurno(ORG, 'c-1'), { wrapper: wrap() });
  act(() => result.current.perguntar('Continue', saved));
  await waitFor(() => expect(result.current.mensagens).toHaveLength(3));
  expect(result.current.mensagens[0].content).toBe('Contexto anterior');
  expect(requests[0].conversa_id).toBe('c-1');
});
