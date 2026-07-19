import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

// ─── Mock Supabase client ────────────────────────────────
const mockMaybeSingle = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

// ─── Mock AuthContext ────────────────────────────────────
const mockUseAuth = vi.fn();
vi.mock('@/modules/identity/auth/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

// ─── Import after mocks ─────────────────────────────────
import { useGestor } from '@/modules/identity/gestor/hooks/useGestor';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const FAKE_USER_ID = 'usr-00000000-0000-0000-0000-000000000009';

const GESTOR_ROW = {
  id: 'gestor-1',
  user_id: FAKE_USER_ID,
  is_active: true,
  notes: null,
  created_at: '2026-07-19T00:00:00Z',
};

function setupSupabaseMock(response: { data: unknown; error: unknown }) {
  mockMaybeSingle.mockResolvedValue(response);
  // Builder: from() -> select() -> eq() -> eq() -> maybeSingle()
  const eqSecond = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
  const eqFirst = vi.fn().mockReturnValue({ eq: eqSecond });
  mockSelect.mockReturnValue({ eq: eqFirst });
  mockFrom.mockReturnValue({ select: mockSelect });
}

describe('useGestor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ user: { id: FAKE_USER_ID } });
  });

  it('isGestor=true + gestorId set when active gestores row exists', async () => {
    setupSupabaseMock({ data: GESTOR_ROW, error: null });

    const { result } = renderHook(() => useGestor(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isGestor).toBe(true);
    expect(result.current.gestorId).toBe('gestor-1');
    expect(mockFrom).toHaveBeenCalledWith('gestores');
  });

  it('isGestor=false when no gestores row', async () => {
    setupSupabaseMock({ data: null, error: null });

    const { result } = renderHook(() => useGestor(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isGestor).toBe(false);
    expect(result.current.gestorId).toBeNull();
  });

  it('isGestor=false and no console.error on PGRST116', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupSupabaseMock({ data: null, error: { code: 'PGRST116', message: 'not found' } });

    const { result } = renderHook(() => useGestor(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isGestor).toBe(false);
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
