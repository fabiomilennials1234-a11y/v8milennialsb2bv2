import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock Supabase ───────────────────────────────────────
const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null });
const mockGetSession = vi.fn();
const mockGetUser = vi.fn();
let ouvinteDeSessao: ((evento: string, session: unknown) => void) | null = null;

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      getUser: () => mockGetUser(),
      onAuthStateChange: (cb: (evento: string, session: unknown) => void) => {
        ouvinteDeSessao = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
    from: vi.fn().mockReturnValue({
      insert: (...args: unknown[]) => mockInsert(...args),
    }),
  },
}));

import { track, trackLote, acompanharSessaoParaLote, __resetarSessaoDoLoteParaTestes } from '@/lib/analytics';

describe('analytics — track()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockResolvedValue({ data: null, error: null });
  });

  it('calls supabase.from("usage_events").insert with correct fields', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
    });

    track({
      event: 'lead_created',
      organizationId: 'org-1',
      entityType: 'lead',
      entityId: 'lead-1',
      metadata: { source: 'manual' },
    });

    // track is fire-and-forget — wait for async to settle
    await vi.waitFor(() => {
      expect(mockInsert).toHaveBeenCalled();
    });

    expect(mockInsert).toHaveBeenCalledWith({
      organization_id: 'org-1',
      user_id: 'user-1',
      event_type: 'lead_created',
      entity_type: 'lead',
      entity_id: 'lead-1',
      metadata: { source: 'manual' },
    });
  });

  it('does not throw if Supabase fails', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
    });
    mockInsert.mockRejectedValue(new Error('DB down'));

    expect(() => {
      track({
        event: 'lead_created',
        organizationId: 'org-1',
      });
    }).not.toThrow();

    // Give async time to settle without throwing
    await new Promise((r) => setTimeout(r, 50));
  });

  it('does not throw if user is not logged in', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
    });

    expect(() => {
      track({
        event: 'lead_created',
        organizationId: 'org-1',
      });
    }).not.toThrow();

    await new Promise((r) => setTimeout(r, 50));
    // insert should NOT have been called since user is null
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('does not call insert if organizationId is empty', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
    });

    track({
      event: 'lead_created',
      organizationId: '',
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('lê o usuário da sessão em cache — nunca chama getUser (ida a /auth/v1/user por evento)', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
    });

    track({ event: 'card_moved', organizationId: 'org-1', entityType: 'pipe_x', entityId: 'e-1' });

    await vi.waitFor(() => {
      expect(mockInsert).toHaveBeenCalledWith({
        organization_id: 'org-1',
        user_id: 'user-1',
        event_type: 'card_moved',
        entity_type: 'pipe_x',
        entity_id: 'e-1',
        metadata: null,
      });
    });
    expect(mockGetSession).toHaveBeenCalledTimes(1);
    expect(mockGetUser).not.toHaveBeenCalled();
  });
});

describe('analytics — trackLote()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockResolvedValue({ data: null, error: null });
  });

  it('grava o lote num INSERT só, sem entidade, e descarta linha sem org', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });

    trackLote([
      { event: 'perf_util', organizationId: 'org-1', metadata: { tela: 'funil', ms: 300 } },
      { event: 'web_vital', organizationId: '', metadata: { nome: 'LCP' } },
      { event: 'web_vital', organizationId: 'org-1', metadata: { nome: 'INP' } },
    ]);

    await vi.waitFor(() => expect(mockInsert).toHaveBeenCalledTimes(1));
    expect(mockInsert).toHaveBeenCalledWith([
      { organization_id: 'org-1', user_id: 'user-1', event_type: 'perf_util', entity_type: null, entity_id: null, metadata: { tela: 'funil', ms: 300 } },
      { organization_id: 'org-1', user_id: 'user-1', event_type: 'web_vital', entity_type: null, entity_id: null, metadata: { nome: 'INP' } },
    ]);
  });

  it('lote vazio ou sem sessão não grava e não lança', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    expect(() => trackLote([])).not.toThrow();
    trackLote([{ event: 'perf_util', organizationId: 'org-1', metadata: {} }]);
    await new Promise((r) => setTimeout(r, 20));
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe('analytics — trackLote ao sair da página (keepalive)', () => {
  const lote = [{ event: 'perf_util' as const, organizationId: 'org-1', metadata: { tela: 'chat', ms: 10, origem: 'carga', amostra: 0.5, v: 1 } }];
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetarSessaoDoLoteParaTestes();
    ouvinteDeSessao = null;
    vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.test.invalid');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'chave-publica');
    fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('com sessão em memória: fetch keepalive síncrono, sem await de getSession, mesmas colunas', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'jwt-1', user: { id: 'user-1' } } } });
    acompanharSessaoParaLote();
    await vi.waitFor(() => expect(mockGetSession).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    mockGetSession.mockClear();

    trackLote(lote, { saindo: true });

    // Síncrono: o fetch já saiu, antes de qualquer microtask.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://proj.test.invalid/rest/v1/usage_events');
    expect(init).toMatchObject({ method: 'POST', keepalive: true });
    expect(init.headers).toMatchObject({ apikey: 'chave-publica', Authorization: 'Bearer jwt-1', Prefer: 'return=minimal' });
    expect(JSON.parse(String(init.body))).toEqual([{
      organization_id: 'org-1', user_id: 'user-1', event_type: 'perf_util',
      entity_type: null, entity_id: null, metadata: lote[0].metadata,
    }]);
  });

  it('o token acompanha a sessão (refresh/logout); sem sessão cai no caminho normal', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    acompanharSessaoParaLote();
    await vi.waitFor(() => expect(ouvinteDeSessao).not.toBeNull());
    ouvinteDeSessao!('TOKEN_REFRESHED', { access_token: 'jwt-novo', user: { id: 'user-1' } });
    trackLote(lote, { saindo: true });
    expect((fetchSpy.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer jwt-novo' });

    ouvinteDeSessao!('SIGNED_OUT', null);
    trackLote(lote, { saindo: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Caminho normal (sem sessão no getSession também): nada grava.
    await Promise.resolve();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('linha sem org é descartada também na saída', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'jwt-1', user: { id: 'user-1' } } } });
    acompanharSessaoParaLote();
    await vi.waitFor(() => expect(mockGetSession).toHaveBeenCalled());
    await Promise.resolve();
    trackLote([{ ...lote[0], organizationId: '' }], { saindo: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
