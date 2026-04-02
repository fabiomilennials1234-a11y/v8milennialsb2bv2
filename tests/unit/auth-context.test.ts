import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';

// ─── Mock Supabase client ────────────────────────────────
const mockSignInWithPassword = vi.fn();
const mockSignUp = vi.fn();
const mockSignOut = vi.fn();
const mockGetSession = vi.fn();

let authStateCallback: (event: string, session: unknown) => void;
const mockUnsubscribe = vi.fn();

const mockOnAuthStateChange = vi.fn().mockImplementation((cb: (event: string, session: unknown) => void) => {
  authStateCallback = cb;
  return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
      signUp: (...args: unknown[]) => mockSignUp(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
      getSession: () => mockGetSession(),
      onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args),
    },
  },
}));

// ─── Mock import.meta.env ────────────────────────────────
const MOCK_SUPABASE_URL = 'https://test-project.supabase.co';
vi.stubEnv('VITE_SUPABASE_URL', MOCK_SUPABASE_URL);

// ─── Mock global.fetch ───────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ─── Import module under test ────────────────────────────
import { AuthProvider, useAuth } from '@/contexts/AuthContext';

// ─── Helpers ─────────────────────────────────────────────

function createWrapper() {
  return ({ children }: { children: ReactNode }) =>
    createElement(AuthProvider, null, children);
}

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    access_token: 'tok_abc12345678901234567890',
    user: { id: 'user-1', email: 'test@example.com' },
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: getSession resolves with no session (no side effects)
    mockGetSession.mockResolvedValue({ data: { session: null } });
    // Default: fetch resolves ok with no attach
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    // Re-stub env in case a test cleared it
    vi.stubEnv('VITE_SUPABASE_URL', MOCK_SUPABASE_URL);
  });

  // ── 1 ──────────────────────────────────────────────────
  it('useAuth throws when used outside AuthProvider', () => {
    expect(() => {
      renderHook(() => useAuth());
    }).toThrow('useAuth must be used within an AuthProvider');
  });

  // ── 2 ──────────────────────────────────────────────────
  it('AuthProvider sets loading=true initially', () => {
    // Prevent getSession from resolving during the assertion
    mockGetSession.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() });

    expect(result.current.loading).toBe(true);
  });

  // ── 3 ──────────────────────────────────────────────────
  it('signIn calls supabase.auth.signInWithPassword with email and password', async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null });

    const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.signIn('user@test.com', 'pass123');
    });

    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: 'user@test.com',
      password: 'pass123',
    });
  });

  // ── 4 ──────────────────────────────────────────────────
  it('signIn returns error when auth fails', async () => {
    const authError = new Error('Invalid credentials');
    mockSignInWithPassword.mockResolvedValue({ error: authError });

    const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() });

    let response: { error: Error | null } = { error: null };
    await act(async () => {
      response = await result.current.signIn('user@test.com', 'wrong');
    });

    expect(response.error).toBe(authError);
  });

  // ── 5 ──────────────────────────────────────────────────
  it('signUp calls supabase.auth.signUp with email, password, fullName metadata, and emailRedirectTo', async () => {
    mockSignUp.mockResolvedValue({ error: null });

    const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.signUp('user@test.com', 'pass123', 'John Doe');
    });

    expect(mockSignUp).toHaveBeenCalledWith({
      email: 'user@test.com',
      password: 'pass123',
      options: {
        emailRedirectTo: expect.stringContaining('/'),
        data: { full_name: 'John Doe' },
      },
    });
  });

  // ── 6 ──────────────────────────────────────────────────
  it('signUp returns error when auth fails', async () => {
    const authError = new Error('Email already registered');
    mockSignUp.mockResolvedValue({ error: authError });

    const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() });

    let response: { error: Error | null } = { error: null };
    await act(async () => {
      response = await result.current.signUp('user@test.com', 'pass123', 'John Doe');
    });

    expect(response.error).toBe(authError);
  });

  // ── 7 ──────────────────────────────────────────────────
  it('signOut calls supabase.auth.signOut', async () => {
    mockSignOut.mockResolvedValue({});

    const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.signOut();
    });

    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  // ── 8 ──────────────────────────────────────────────────
  it('onAuthStateChange SIGNED_IN sets user and session', async () => {
    const session = makeSession();
    // Prevent getSession from resolving (it would overwrite state with null)
    mockGetSession.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() });

    await act(async () => {
      authStateCallback('SIGNED_IN', session);
    });

    expect(result.current.user).toEqual(session.user);
    expect(result.current.session).toEqual(session);
  });

  // ── 9 ──────────────────────────────────────────────────
  it('onAuthStateChange sets loading=false', async () => {
    // Start with a pending getSession so loading stays true
    mockGetSession.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() });

    expect(result.current.loading).toBe(true);

    await act(async () => {
      authStateCallback('INITIAL_SESSION', null);
    });

    expect(result.current.loading).toBe(false);
  });

  // ── 10 ─────────────────────────────────────────────────
  it('getSession sets user and session on mount', async () => {
    const session = makeSession();
    mockGetSession.mockResolvedValue({ data: { session } });

    const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() });

    // Both onAuthStateChange and getSession set state.
    // Simulate the auth state change that Supabase fires with the session from getSession.
    await act(async () => {
      authStateCallback('INITIAL_SESSION', session);
    });

    expect(result.current.user).toEqual(session.user);
    expect(result.current.session).toEqual(session);
    expect(result.current.loading).toBe(false);
  });

  // ── 11 ─────────────────────────────────────────────────
  it('attachToOrgByPendingInvite is called on SIGNED_IN with access_token', async () => {
    const session = makeSession();

    const { result: _ } = renderHook(() => useAuth(), { wrapper: createWrapper() });

    await act(async () => {
      authStateCallback('SIGNED_IN', session);
    });

    // Allow microtask queue to flush
    await act(async () => {
      await Promise.resolve();
    });

    // The URL uses import.meta.env.VITE_SUPABASE_URL evaluated at module load time.
    // We verify the path and headers rather than the exact base URL.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOpts] = mockFetch.mock.calls[0];
    expect(calledUrl).toContain('/functions/v1/attach-to-org-by-pending-invite');
    expect(calledOpts.method).toBe('POST');
    expect(calledOpts.headers.Authorization).toBe(`Bearer ${session.access_token}`);
    expect(calledOpts.headers['Content-Type']).toBe('application/json');
  });

  // ── 12 ─────────────────────────────────────────────────
  it('attachToOrgByPendingInvite dedup: not called twice for same userId:token', async () => {
    const session = makeSession();

    const { result: _ } = renderHook(() => useAuth(), { wrapper: createWrapper() });

    await act(async () => {
      authStateCallback('SIGNED_IN', session);
    });
    await act(async () => {
      await Promise.resolve();
    });

    mockFetch.mockClear();

    // Fire the same event again with identical session
    await act(async () => {
      authStateCallback('SIGNED_IN', session);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── 13 ─────────────────────────────────────────────────
  it('attachToOrgByPendingInvite dedup: called again for different token', async () => {
    const session1 = makeSession({ access_token: 'tok_first_1234567890123456789' });
    const session2 = makeSession({ access_token: 'tok_second_234567890123456789' });

    const { result: _ } = renderHook(() => useAuth(), { wrapper: createWrapper() });

    await act(async () => {
      authStateCallback('SIGNED_IN', session1);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    mockFetch.mockClear();

    await act(async () => {
      authStateCallback('SIGNED_IN', session2);
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Second call with a different token should trigger fetch again
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // ── 14 ─────────────────────────────────────────────────
  it('attachToOrgByPendingInvite silently ignores when SUPABASE_URL is empty', async () => {
    // NOTE: import.meta.env.VITE_SUPABASE_URL is captured at module load time
    // in the const SUPABASE_URL. Since the module was already loaded with a valid URL,
    // we test this by verifying the function's guard clause behavior.
    // The guard `if (!SUPABASE_URL?.trim()) return;` would skip fetch when URL is empty.
    // We simulate this indirectly: if fetch is NOT called, the guard worked.
    // For a fresh module re-evaluation we'd need vi.resetModules(), but that conflicts
    // with the other tests sharing the same mock setup.
    // Instead, we verify the production code path: when URL is empty string,
    // the function returns early. We test this by checking the guard exists in source
    // and verifying normal flow calls fetch (tested in case 11).

    // We can test this more directly by re-importing with empty env:
    vi.stubEnv('VITE_SUPABASE_URL', '');

    // Dynamically re-import the module with the new env
    vi.resetModules();

    // Re-apply the supabase mock after resetModules
    vi.doMock('@/integrations/supabase/client', () => ({
      supabase: {
        auth: {
          signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
          signUp: (...args: unknown[]) => mockSignUp(...args),
          signOut: (...args: unknown[]) => mockSignOut(...args),
          getSession: () => mockGetSession(),
          onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args),
        },
      },
    }));

    const { AuthProvider: FreshAuthProvider, useAuth: freshUseAuth } = await import(
      '@/contexts/AuthContext'
    );

    const freshWrapper = ({ children }: { children: ReactNode }) =>
      createElement(FreshAuthProvider, null, children);

    mockFetch.mockClear();
    const session = makeSession();

    const { result: _ } = renderHook(() => freshUseAuth(), { wrapper: freshWrapper });

    await act(async () => {
      authStateCallback('SIGNED_IN', session);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── 15 ─────────────────────────────────────────────────
  it('attachToOrgByPendingInvite silently ignores fetch errors', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const session = makeSession();

    const { result: _ } = renderHook(() => useAuth(), { wrapper: createWrapper() });

    // Should not throw — the error is caught silently
    await act(async () => {
      authStateCallback('SIGNED_IN', session);
    });
    await act(async () => {
      await Promise.resolve();
    });

    // The hook should still work fine after the fetch error
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
