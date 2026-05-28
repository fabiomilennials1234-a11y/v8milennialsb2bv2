import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ─── Mock: useCurrentTeamMember ─────────────────────────
const mockUseCurrentTeamMember = vi.fn();

vi.mock('@/modules/identity/hooks/useTeamMembers', () => ({
  useCurrentTeamMember: () => mockUseCurrentTeamMember(),
}));

// ─── Mock: Supabase client ──────────────────────────────
const mockSingle = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

// ─── Import after mocks ─────────────────────────────────
import { useOrganization, useRequiredOrganization } from '@/modules/identity/hooks/useOrganization';

// ─── Helpers ────────────────────────────────────────────
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function setupSupabaseMock(returnValue: { data: unknown; error: unknown }) {
  mockSingle.mockResolvedValue(returnValue);
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: mockSingle,
      }),
    }),
  });
}

// ─── Tests ──────────────────────────────────────────────
describe('useOrganization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1
  it('returns organizationId from teamMember.organization_id', () => {
    mockUseCurrentTeamMember.mockReturnValue({
      data: { id: 'tm-1', organization_id: 'org-123', role: 'admin' },
      isLoading: false,
      error: null,
    });
    setupSupabaseMock({ data: { org_type: 'crm' }, error: null });

    const { result } = renderHook(() => useOrganization(), { wrapper: createWrapper() });

    expect(result.current.organizationId).toBe('org-123');
  });

  // 2
  it('returns null organizationId when teamMember is null', () => {
    mockUseCurrentTeamMember.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    });

    const { result } = renderHook(() => useOrganization(), { wrapper: createWrapper() });

    expect(result.current.organizationId).toBeNull();
  });

  // 3
  it('isReady=true when teamMember loaded and has org_id (does NOT wait for orgType)', () => {
    mockUseCurrentTeamMember.mockReturnValue({
      data: { id: 'tm-1', organization_id: 'org-123', role: 'member' },
      isLoading: false,
      error: null,
    });
    // Supabase query for org_type will be triggered but hasn't resolved yet.
    // isReady should STILL be true because it doesn't wait for orgLoading.
    setupSupabaseMock({ data: null, error: null });

    const { result } = renderHook(() => useOrganization(), { wrapper: createWrapper() });

    expect(result.current.isReady).toBe(true);
  });

  // 4
  it('isReady=false when teamMember is still loading', () => {
    mockUseCurrentTeamMember.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    const { result } = renderHook(() => useOrganization(), { wrapper: createWrapper() });

    expect(result.current.isReady).toBe(false);
  });

  // 5
  it('isReady=false when teamMember has no organization_id', () => {
    mockUseCurrentTeamMember.mockReturnValue({
      data: { id: 'tm-1', organization_id: null, role: 'member' },
      isLoading: false,
      error: null,
    });

    const { result } = renderHook(() => useOrganization(), { wrapper: createWrapper() });

    expect(result.current.isReady).toBe(false);
  });

  // 6
  it('isLoading=true when teamMember is loading', () => {
    mockUseCurrentTeamMember.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    const { result } = renderHook(() => useOrganization(), { wrapper: createWrapper() });

    expect(result.current.isLoading).toBe(true);
  });

  // 7
  it('isLoading=true when orgId exists and org query is loading', () => {
    mockUseCurrentTeamMember.mockReturnValue({
      data: { id: 'tm-1', organization_id: 'org-123', role: 'member' },
      isLoading: false,
      error: null,
    });
    // Return a never-resolving promise so the org query stays in loading state
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockReturnValue(new Promise(() => {})),
        }),
      }),
    });

    const { result } = renderHook(() => useOrganization(), { wrapper: createWrapper() });

    // On initial render, useQuery with enabled=true and a pending queryFn -> isLoading=true
    expect(result.current.isLoading).toBe(true);
  });

  // 8
  it('isLoading=false when both resolved', async () => {
    mockUseCurrentTeamMember.mockReturnValue({
      data: { id: 'tm-1', organization_id: 'org-123', role: 'admin' },
      isLoading: false,
      error: null,
    });
    setupSupabaseMock({ data: { org_type: 'crm' }, error: null });

    const { result } = renderHook(() => useOrganization(), { wrapper: createWrapper() });

    // Wait for the org query to resolve
    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  // 9
  it('orgType comes from organizations table query', async () => {
    mockUseCurrentTeamMember.mockReturnValue({
      data: { id: 'tm-1', organization_id: 'org-123', role: 'admin' },
      isLoading: false,
      error: null,
    });
    setupSupabaseMock({ data: { org_type: 'outbound' }, error: null });

    const { result } = renderHook(() => useOrganization(), { wrapper: createWrapper() });

    await vi.waitFor(() => {
      expect(result.current.orgType).toBe('outbound');
    });
  });
});

describe('useRequiredOrganization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 10
  it('throws when !isLoading and !organizationId', () => {
    mockUseCurrentTeamMember.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    });

    expect(() => {
      renderHook(() => useRequiredOrganization(), { wrapper: createWrapper() });
    }).toThrow('Organization context is required but not available');
  });

  // 11
  it('does NOT throw during loading', () => {
    mockUseCurrentTeamMember.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    expect(() => {
      renderHook(() => useRequiredOrganization(), { wrapper: createWrapper() });
    }).not.toThrow();
  });

  // 12
  it('returns context when org is available', () => {
    mockUseCurrentTeamMember.mockReturnValue({
      data: { id: 'tm-1', organization_id: 'org-456', role: 'admin' },
      isLoading: false,
      error: null,
    });
    setupSupabaseMock({ data: { org_type: 'crm' }, error: null });

    const { result } = renderHook(() => useRequiredOrganization(), { wrapper: createWrapper() });

    expect(result.current.organizationId).toBe('org-456');
    expect(result.current.teamMemberId).toBe('tm-1');
    expect(result.current.role).toBe('admin');
    expect(result.current.isReady).toBe(true);
  });
});
