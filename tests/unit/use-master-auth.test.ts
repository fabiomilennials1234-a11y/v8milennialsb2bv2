import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

// ─── Mock Supabase client ────────────────────────────────
const mockSingle = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

// ─── Mock AuthContext ────────────────────────────────────
const mockUseAuth = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

// ─── Import after mocks ─────────────────────────────────
import { useMasterAuth, useCanAccessMaster } from '@/hooks/useMasterAuth';

// ─── Helpers ─────────────────────────────────────────────
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const FAKE_USER_ID = 'usr-00000000-0000-0000-0000-000000000001';

const MASTER_ROW = {
  id: 'master-1',
  user_id: FAKE_USER_ID,
  permissions: { all: true },
  is_active: true,
  granted_at: '2025-01-01T00:00:00Z',
  notes: null,
};

function setupSupabaseMock(response: { data: unknown; error: unknown }) {
  mockSingle.mockResolvedValue(response);

  // Builder pattern: from() -> select() -> eq() -> eq() -> single()
  const eqSecond = vi.fn().mockReturnValue({ single: mockSingle });
  const eqFirst = vi.fn().mockReturnValue({ eq: eqSecond });
  mockSelect.mockReturnValue({ eq: eqFirst });
  mockFrom.mockReturnValue({ select: mockSelect });
}

// ─── Tests ───────────────────────────────────────────────
describe('useMasterAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ user: { id: FAKE_USER_ID } });
  });

  // 1. isMaster=true when master_users row exists with is_active=true
  it('isMaster=true when master_users row exists with is_active=true', async () => {
    setupSupabaseMock({ data: MASTER_ROW, error: null });

    const { result } = renderHook(() => useMasterAuth(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isMaster).toBe(true);
    expect(result.current.masterUser).toEqual(MASTER_ROW);
  });

  // 2. isMaster=false when no row in master_users
  it('isMaster=false when no row in master_users', async () => {
    setupSupabaseMock({ data: null, error: null });

    const { result } = renderHook(() => useMasterAuth(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isMaster).toBe(false);
    expect(result.current.masterUser).toBeNull();
  });

  // 3. isMaster=false when PGRST116 error (not found)
  it('isMaster=false when PGRST116 error (not found)', async () => {
    setupSupabaseMock({
      data: null,
      error: { code: 'PGRST116', message: 'not found' },
    });

    const { result } = renderHook(() => useMasterAuth(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isMaster).toBe(false);
    expect(result.current.masterUser).toBeNull();
  });

  // 4. PGRST116 error is silently handled (no throw)
  it('PGRST116 error is silently handled (no throw)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    setupSupabaseMock({
      data: null,
      error: { code: 'PGRST116', message: 'not found' },
    });

    const { result } = renderHook(() => useMasterAuth(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // PGRST116 should NOT log to console.error (it is silently swallowed)
    expect(consoleSpy).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();

    consoleSpy.mockRestore();
  });

  // 5. hasPermission returns true for any key when permissions.all=true
  it('hasPermission returns true for any key when permissions.all=true', async () => {
    setupSupabaseMock({
      data: { ...MASTER_ROW, permissions: { all: true } },
      error: null,
    });

    const { result } = renderHook(() => useMasterAuth(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasPermission('organizations')).toBe(true);
    expect(result.current.hasPermission('billing')).toBe(true);
    expect(result.current.hasPermission('audit')).toBe(true);
    expect(result.current.hasPermission('impersonation')).toBe(true);
  });

  // 6. hasPermission returns specific value when all=false
  it('hasPermission returns specific value when all=false', async () => {
    setupSupabaseMock({
      data: {
        ...MASTER_ROW,
        permissions: { all: false, organizations: true, billing: false },
      },
      error: null,
    });

    const { result } = renderHook(() => useMasterAuth(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasPermission('organizations')).toBe(true);
    expect(result.current.hasPermission('billing')).toBe(false);
    expect(result.current.hasPermission('audit')).toBe(false);
  });

  // 7. hasPermission returns false when masterUser is null
  it('hasPermission returns false when masterUser is null', async () => {
    setupSupabaseMock({ data: null, error: null });

    const { result } = renderHook(() => useMasterAuth(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasPermission('organizations')).toBe(false);
    expect(result.current.hasPermission('all')).toBe(false);
  });

  // 8. isOutbounder=true when master AND !all AND outbound_only
  it('isOutbounder=true when master AND !all AND outbound_only', async () => {
    setupSupabaseMock({
      data: {
        ...MASTER_ROW,
        permissions: { all: false, outbound_only: true },
      },
      error: null,
    });

    const { result } = renderHook(() => useMasterAuth(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isOutbounder).toBe(true);
  });

  // 9. isOutbounder=false when all=true even with outbound_only
  it('isOutbounder=false when all=true even with outbound_only', async () => {
    setupSupabaseMock({
      data: {
        ...MASTER_ROW,
        permissions: { all: true, outbound_only: true },
      },
      error: null,
    });

    const { result } = renderHook(() => useMasterAuth(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isOutbounder).toBe(false);
  });
});

// 10. useCanAccessMaster returns canAccess matching isMaster
describe('useCanAccessMaster', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ user: { id: FAKE_USER_ID } });
  });

  it('returns canAccess matching isMaster', async () => {
    setupSupabaseMock({ data: MASTER_ROW, error: null });

    const { result } = renderHook(() => useCanAccessMaster(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.canAccess).toBe(true);
  });
});
