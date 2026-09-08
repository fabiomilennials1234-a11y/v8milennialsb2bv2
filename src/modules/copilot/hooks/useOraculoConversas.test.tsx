import { useOraculoTurno } from './useOraculoTurno';
import { renderHook, waitFor, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { it, expect, vi, afterEach } from 'vitest';
import { useOraculoConversas, useOraculoTurnos } from './useOraculoConversas';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('histórico consulta somente dono e organização ativa; troca de org refaz leitura', async () => {
  const requests: URL[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init); requests.push(new URL(request.url));
    return Response.json([]);
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result, rerender } = renderHook(({ org }) => ({
    list: useOraculoConversas('owner', org), turns: useOraculoTurnos('conversation', 'owner', org),
  }), { wrapper, initialProps: { org: 'org-a' } });
  await waitFor(() => expect(result.current.list.isSuccess && result.current.turns.isSuccess).toBe(true));
  expect(requests).toHaveLength(2);
  for (const url of requests) {
    expect(url.searchParams.get('organization_id')).toBe('eq.org-a');
    expect(url.searchParams.get('user_id')).toBe('eq.owner');
  }
  rerender({ org: 'org-b' });
  await waitFor(() => expect(requests).toHaveLength(4));
  for (const url of requests.slice(2)) expect(url.searchParams.get('organization_id')).toBe('eq.org-b');
});

it('turno confirmado atualiza histórico mesmo com cache fresco', async () => {
  let persisted = false;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url.includes('/functions/v1/oraculo-turno')) {
      persisted = true;
      return Response.json({ conversa_id: 'conversation', resposta: 'Nova resposta', procedencia: [], restantes_hoje: 23 });
    }
    return Response.json(persisted ? [{ id: 'new', role: 'assistant', content: 'Nova resposta', created_at: new Date().toISOString() }] : []);
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => ({ history: useOraculoTurnos('conversation', 'owner', 'org-a'),
    turn: useOraculoTurno('org-a', 'conversation') }), { wrapper });
  await waitFor(() => expect(result.current.history.isSuccess).toBe(true));
  act(() => result.current.turn.perguntar('Continue'));
  await waitFor(() => expect(result.current.history.data?.[0]?.content).toBe('Nova resposta'));
});

it('GET atrasado bloqueia continuação até histórico estar disponível', async () => {
  let release!: (response: Response) => void;
  let posts = 0;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url.includes('/functions/v1/')) {
      posts++;
      return Response.json({ conversa_id: 'conversation', resposta: 'Resposta', procedencia: [], restantes_hoje: 23 });
    }
    return new Promise<Response>(resolve => { release = resolve; });
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => ({ history: useOraculoTurnos('conversation', 'owner', 'org-a'),
    turn: useOraculoTurno('org-a', 'conversation') }), { wrapper });
  await waitFor(() => expect(release).toBeDefined());
  act(() => result.current.turn.perguntar('Continue', result.current.history.data ?? null));
  expect(result.current.turn.mensagens).toEqual([]);
  expect(posts).toBe(0);
  await act(async () => release(Response.json([{ id: 'old', role: 'assistant', content: 'Anterior', created_at: new Date().toISOString() }])));
  await waitFor(() => expect(result.current.history.isSuccess).toBe(true));
  act(() => result.current.turn.perguntar('Continue', result.current.history.data!));
  await waitFor(() => expect(result.current.turn.mensagens).toHaveLength(3));
  expect(result.current.turn.mensagens[0].content).toBe('Anterior');
});
