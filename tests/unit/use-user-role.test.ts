import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

// ─── Shared mock state ──────────────────────────────────
const mockUser = { id: 'user-1', email: 'test@example.com' };
const mockSession = { access_token: 'jwt-token-abc' };
let mockTeamMember: { id?: string; role?: string; organization_id?: string } | null = null;
let mockIsMaster = false;

// ─── Mock Supabase client ───────────────────────────────
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockLimit = vi.fn();
const mockMaybeSingle = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: (...args: unknown[]) => {
        mockSelect(...args);
        return {
          eq: (...eqArgs: unknown[]) => {
            mockEq(...eqArgs);
            return {
              limit: (...limitArgs: unknown[]) => {
                mockLimit(...limitArgs);
                return {
                  maybeSingle: () => mockMaybeSingle(),
                };
              },
            };
          },
        };
      },
    }),
    auth: {
      getSession: () => mockGetSession(),
    },
  },
}));

// ─── Mock AuthContext ───────────────────────────────────
vi.mock('@/modules/identity/auth/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    session: mockSession,
    loading: false,
  }),
}));

// ─── Mock useTeamMembers ────────────────────────────────
vi.mock('@/modules/identity/hooks/useTeamMembers', () => ({
  useCurrentTeamMember: () => ({
    data: mockTeamMember,
    isLoading: false,
  }),
}));

// ─── Mock useMasterAuth ─────────────────────────────────
vi.mock('@/modules/identity/master/hooks/useMasterAuth', () => ({
  useMasterAuth: () => ({
    isMaster: mockIsMaster,
    masterUser: null,
    permissions: {},
    hasPermission: () => false,
    isLoading: false,
    error: null,
    isOutbounder: false,
  }),
}));

// ─── Stub import.meta.env ───────────────────────────────
vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'anon-key-123');

// ─── Import hooks under test ────────────────────────────
import {
  useUserRole,
  useIsAdmin,
  useFeaturePermissions,
  useFeaturePermission,
  useCanManageCopilot,
  useHasRole,
} from '@/modules/identity/permissions/hooks/useUserRole';

// ─── Helper: QueryClient wrapper ────────────────────────
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

// ─── Tests ──────────────────────────────────────────────

describe('useUserRole hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTeamMember = null;
    mockIsMaster = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 1. useUserRole returns role from currentTeamMember.role (primary source)
  it('useUserRole returns role from currentTeamMember.role (primary source)', async () => {
    mockTeamMember = { id: 'tm-1', role: 'admin', organization_id: 'org-1' };

    const { result } = renderHook(() => useUserRole(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ user_id: 'user-1', role: 'admin' });
    // Should NOT call supabase.from since team member had a role
    expect(mockSelect).not.toHaveBeenCalled();
  });

  // ── 2. useUserRole falls back to user_roles table when teamMember has no role
  it('useUserRole falls back to user_roles table when teamMember has no role', async () => {
    mockTeamMember = { id: 'tm-1', organization_id: 'org-1' }; // no role field
    mockMaybeSingle.mockResolvedValue({
      data: { user_id: 'user-1', role: 'member' },
      error: null,
    });

    const { result } = renderHook(() => useUserRole(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ user_id: 'user-1', role: 'member' });
    expect(mockMaybeSingle).toHaveBeenCalled();
  });

  // ── 3. useIsAdmin returns true when role === "admin"
  it('useIsAdmin returns true when role === "admin"', async () => {
    mockTeamMember = { id: 'tm-1', role: 'admin', organization_id: 'org-1' };

    const { result } = renderHook(() => useIsAdmin(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAdmin).toBe(true);
  });

  // ── 4. useIsAdmin returns false when role === "member"
  it('useIsAdmin returns false when role === "member"', async () => {
    mockTeamMember = { id: 'tm-1', role: 'member', organization_id: 'org-1' };

    const { result } = renderHook(() => useIsAdmin(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAdmin).toBe(false);
  });

  // ── 5. useFeaturePermissions calls get-member-permissions edge function with JWT
  it('useFeaturePermissions calls get-member-permissions edge function with JWT', async () => {
    mockTeamMember = { id: 'tm-1', role: 'member', organization_id: 'org-1' };
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'jwt-token-abc' } },
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ features: { 'copilot.create': true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { result } = renderHook(() => useFeaturePermissions(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://test.supabase.co/functions/v1/get-member-permissions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-User-JWT': 'jwt-token-abc',
          Authorization: 'Bearer anon-key-123',
        }),
      }),
    );
    expect(result.current.data).toEqual({ 'copilot.create': true });

    fetchSpy.mockRestore();
  });

  // ── 6. useFeaturePermissions surfaces error when edge function fails
  // (antes silenciava como {}; hotfix 2026-04-24 propaga para o
  // PermissionProtectedRoute diferenciar falha técnica de "sem permissão")
  it('useFeaturePermissions surfaces error when edge function fails', async () => {
    mockTeamMember = { id: 'tm-1', role: 'member', organization_id: 'org-1' };
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'jwt-token-abc' } },
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    );

    const { result } = renderHook(() => useFeaturePermissions(), { wrapper: createWrapper() });

    await waitFor(
      () => expect(result.current.isError).toBe(true),
      { timeout: 5000 },
    );
    expect(result.current.data).toBeUndefined();
    expect(String(result.current.error)).toMatch(/get-member-permissions 500/);

    fetchSpy.mockRestore();
  });

  // ── 7. useFeaturePermission returns true for master regardless of feature
  it('useFeaturePermission returns true for master regardless of feature', async () => {
    mockTeamMember = { id: 'tm-1', role: 'member', organization_id: 'org-1' };
    mockIsMaster = true;
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'jwt-token-abc' } },
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ features: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { result } = renderHook(() => useFeaturePermission('anything.random'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.allowed).toBe(true);

    fetchSpy.mockRestore();
  });

  // ── 8. useFeaturePermission returns true for admin regardless of feature
  it('useFeaturePermission returns true for admin regardless of feature', async () => {
    mockTeamMember = { id: 'tm-1', role: 'admin', organization_id: 'org-1' };
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'jwt-token-abc' } },
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ features: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { result } = renderHook(() => useFeaturePermission('anything.random'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.allowed).toBe(true);

    fetchSpy.mockRestore();
  });

  // ── 9. useFeaturePermission returns features[key] value for regular member
  it('useFeaturePermission returns features[key] value for regular member', async () => {
    mockTeamMember = { id: 'tm-1', role: 'member', organization_id: 'org-1' };
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'jwt-token-abc' } },
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ features: { 'copilot.create': true, 'copilot.delete': false } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const { result } = renderHook(() => useFeaturePermission('copilot.create'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.allowed).toBe(true);

    fetchSpy.mockRestore();
  });

  // ── 10. useFeaturePermission returns false for unknown feature key
  it('useFeaturePermission returns false for unknown feature key', async () => {
    mockTeamMember = { id: 'tm-1', role: 'member', organization_id: 'org-1' };
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'jwt-token-abc' } },
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ features: { 'copilot.create': true } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const { result } = renderHook(() => useFeaturePermission('nonexistent.feature'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.allowed).toBe(false);

    fetchSpy.mockRestore();
  });

  // ── 11. useCanManageCopilot checks 4 copilot feature keys
  it('useCanManageCopilot checks 4 copilot feature keys', async () => {
    mockTeamMember = { id: 'tm-1', role: 'member', organization_id: 'org-1' };
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'jwt-token-abc' } },
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          features: {
            'copilot.create': true,
            'copilot.edit': true,
            'copilot.delete': false,
            'copilot.toggle': true,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const { result } = renderHook(() => useCanManageCopilot(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.canCreate).toBe(true);
    expect(result.current.canEdit).toBe(true);
    expect(result.current.canDelete).toBe(false);
    expect(result.current.canToggle).toBe(true);
    expect(result.current.canManage).toBe(true); // alias for canCreate

    fetchSpy.mockRestore();
  });

  // ── 12. useHasRole matches exact role string
  it('useHasRole matches exact role string', async () => {
    mockTeamMember = { id: 'tm-1', role: 'member', organization_id: 'org-1' };

    const { result } = renderHook(() => useHasRole('member'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasRole).toBe(true);

    // Re-render with a different role check using a new wrapper for fresh query client
    const { result: result2 } = renderHook(() => useHasRole('admin'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result2.current.isLoading).toBe(false));
    expect(result2.current.hasRole).toBe(false);
  });
});
