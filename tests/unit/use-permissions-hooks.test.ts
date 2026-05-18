/**
 * Unit tests for permission hooks.
 *
 * Covers:
 *   - usePermission          (src/lib/permissions.ts)
 *   - useCanPerformAction    (src/lib/permissions.ts)  — SYNC
 *   - useCanPerformActionAsync (src/lib/permissions.ts) — ASYNC
 *   - useHasPermission       (src/hooks/usePermissions.ts)
 *
 * Key finding documented here: the sync and async permission hooks diverge
 * for actions mapped to ACTION_TO_ORG_PERMISSION or ACTION_TO_MATRIX.
 * The sync hook uses a permissive fallback; the async hook actually checks
 * the RPC / matrix table and may deny.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ─── Mock: Supabase client ──────────────────────────────

const mockRpc = vi.fn();
const mockMaybeSingle = vi.fn();
const mockEq3 = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockEq2 = vi.fn(() => ({ eq: mockEq3 }));
const mockEq1 = vi.fn(() => ({ eq: mockEq2 }));
const mockSelect = vi.fn(() => ({ eq: mockEq1 }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

// ─── Mock: useOrganization ──────────────────────────────

const mockUseOrganization = vi.fn();
vi.mock('@/hooks/useOrganization', () => ({
  useOrganization: (...args: unknown[]) => mockUseOrganization(...args),
}));

// ─── Mock: useUserRole & useFeaturePermissions ──────────

const mockUseUserRole = vi.fn();
const mockUseFeaturePermissions = vi.fn();
vi.mock('@/hooks/useUserRole', () => ({
  useUserRole: (...args: unknown[]) => mockUseUserRole(...args),
  useFeaturePermissions: (...args: unknown[]) => mockUseFeaturePermissions(...args),
}));

// ─── Mock: useCurrentTeamMember ─────────────────────────

const mockUseCurrentTeamMember = vi.fn();
vi.mock('@/hooks/useTeamMembers', () => ({
  useCurrentTeamMember: (...args: unknown[]) => mockUseCurrentTeamMember(...args),
}));

// ─── Mock: useMasterAuth ────────────────────────────────

const mockUseMasterAuth = vi.fn();
vi.mock('@/hooks/useMasterAuth', () => ({
  useMasterAuth: (...args: unknown[]) => mockUseMasterAuth(...args),
}));

// ─── Mock: AuthContext (needed by useHasPermission's transitive deps) ──

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

// ─── Imports under test ─────────────────────────────────

import {
  usePermission,
  useCanPerformAction,
  useCanPerformActionAsync,
} from '@/lib/permissions';

import { useHasPermission } from '@/hooks/usePermissions';

// ─── Test utilities ─────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

// ─── Preset mock helpers ────────────────────────────────

function mockAdmin() {
  mockUseUserRole.mockReturnValue({ data: { role: 'admin' }, isLoading: false });
  mockUseMasterAuth.mockReturnValue({ isMaster: false, isLoading: false });
  mockUseOrganization.mockReturnValue({ organizationId: 'org-1', isReady: true });
  mockUseCurrentTeamMember.mockReturnValue({ data: { id: 'tm-1', role: 'admin' }, isLoading: false });
  mockUseFeaturePermissions.mockReturnValue({ data: {}, isLoading: false });
}

function mockMaster() {
  mockUseUserRole.mockReturnValue({ data: { role: 'member' }, isLoading: false });
  mockUseMasterAuth.mockReturnValue({ isMaster: true, isLoading: false });
  mockUseOrganization.mockReturnValue({ organizationId: 'org-1', isReady: true });
  mockUseCurrentTeamMember.mockReturnValue({ data: { id: 'tm-1', role: 'member' }, isLoading: false });
  mockUseFeaturePermissions.mockReturnValue({ data: {}, isLoading: false });
}

function mockMember(featurePerms: Record<string, boolean> = {}) {
  mockUseUserRole.mockReturnValue({ data: { role: 'member' }, isLoading: false });
  mockUseMasterAuth.mockReturnValue({ isMaster: false, isLoading: false });
  mockUseOrganization.mockReturnValue({ organizationId: 'org-1', isReady: true });
  mockUseCurrentTeamMember.mockReturnValue({ data: { id: 'tm-1', role: 'member' }, isLoading: false });
  mockUseFeaturePermissions.mockReturnValue({ data: featurePerms, isLoading: false });
}

function mockLoading() {
  mockUseUserRole.mockReturnValue({ data: null, isLoading: true });
  mockUseMasterAuth.mockReturnValue({ isMaster: false, isLoading: true });
  mockUseOrganization.mockReturnValue({ organizationId: null, isReady: false });
  mockUseCurrentTeamMember.mockReturnValue({ data: null, isLoading: true });
  mockUseFeaturePermissions.mockReturnValue({ data: null, isLoading: true });
}

function mockNoOrg() {
  mockUseUserRole.mockReturnValue({ data: { role: 'member' }, isLoading: false });
  mockUseMasterAuth.mockReturnValue({ isMaster: false, isLoading: false });
  mockUseOrganization.mockReturnValue({ organizationId: null, isReady: true });
  mockUseCurrentTeamMember.mockReturnValue({ data: { id: 'tm-1', role: 'member' }, isLoading: false });
  mockUseFeaturePermissions.mockReturnValue({ data: {}, isLoading: false });
}

// ─── Tests ──────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════
// usePermission (src/lib/permissions.ts)
// ═══════════════════════════════════════════════════════════

describe('usePermission', () => {
  it('1. admin returns true without RPC call', async () => {
    mockAdmin();
    const { result } = renderHook(() => usePermission('can_delete_leads'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(true);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('2. master returns true without RPC call', async () => {
    mockMaster();
    const { result } = renderHook(() => usePermission('can_delete_leads'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(true);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('3. member calls user_has_org_permission RPC and returns result', async () => {
    mockMember();
    mockRpc.mockResolvedValue({ data: true, error: null });

    const { result } = renderHook(() => usePermission('can_delete_leads'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('user_has_org_permission', {
      p_permission_key: 'can_delete_leads',
    });
  });

  it('4. returns false when organizationId is null', async () => {
    mockNoOrg();

    const { result } = renderHook(() => usePermission('can_delete_leads'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════
// useCanPerformAction — SYNC (src/lib/permissions.ts)
// ═══════════════════════════════════════════════════════════

describe('useCanPerformAction (sync)', () => {
  it('5. returns isLoading:true while dependencies load', () => {
    mockLoading();
    const { result } = renderHook(() => useCanPerformAction('delete_lead'), {
      wrapper: createWrapper(),
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.allowed).toBe(false);
  });

  it('6. admin: always allowed for any action', () => {
    mockAdmin();
    const { result } = renderHook(() => useCanPerformAction('delete_lead'), {
      wrapper: createWrapper(),
    });
    expect(result.current).toEqual({ allowed: true, reason: 'admin', isLoading: false });
  });

  it('7. master: always allowed for any action', () => {
    mockMaster();
    const { result } = renderHook(() => useCanPerformAction('import_leads'), {
      wrapper: createWrapper(),
    });
    expect(result.current).toEqual({ allowed: true, reason: 'admin', isLoading: false });
  });

  it('8. feature action (edit_workflow): allowed when featurePerms["workflows.edit"]=true', () => {
    mockMember({ 'workflows.edit': true });
    const { result } = renderHook(() => useCanPerformAction('edit_workflow'), {
      wrapper: createWrapper(),
    });
    expect(result.current.allowed).toBe(true);
    expect(result.current.reason).toBe('feature:workflows.edit');
  });

  it('9. feature action (edit_workflow): denied when featurePerms["workflows.edit"]=false', () => {
    mockMember({ 'workflows.edit': false });
    const { result } = renderHook(() => useCanPerformAction('edit_workflow'), {
      wrapper: createWrapper(),
    });
    expect(result.current.allowed).toBe(false);
    expect(result.current.reason).toContain('workflows.edit');
  });

  it('10. send_message: always allowed for any user', () => {
    mockMember();
    const { result } = renderHook(() => useCanPerformAction('send_message'), {
      wrapper: createWrapper(),
    });
    expect(result.current).toEqual({ allowed: true, reason: 'open', isLoading: false });
  });

  it('11. non-mapped action: denied via fail-closed fallback', () => {
    mockMember();
    // export_leads is NOT in ACTION_TO_FEATURE, so it hits the fail-closed fallback
    const { result } = renderHook(() => useCanPerformAction('export_leads'), {
      wrapper: createWrapper(),
    });
    expect(result.current.allowed).toBe(false);
    expect(result.current.reason).toBe('unmapped_action');
  });

  // Sync version never checks ACTION_TO_ORG_PERMISSION — now denies via fail-closed
  it('12. delete_lead for member — denied via fail-closed (sync does NOT check org permission)', () => {
    mockMember();
    const { result } = renderHook(() => useCanPerformAction('delete_lead'), {
      wrapper: createWrapper(),
    });
    // delete_lead is mapped in ACTION_TO_ORG_PERMISSION to "can_delete_leads",
    // but the sync hook has no async RPC path — hits fail-closed fallback.
    expect(result.current.allowed).toBe(false);
    expect(result.current.reason).toBe('unmapped_action');
    // No RPC call made
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════
// useCanPerformActionAsync (src/lib/permissions.ts)
// ═══════════════════════════════════════════════════════════

describe('useCanPerformActionAsync', () => {
  it('13. no org: returns {allowed:false, reason:"no_org"}', async () => {
    mockNoOrg();
    const { result } = renderHook(() => useCanPerformActionAsync('delete_lead'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ allowed: false, reason: 'no_org' });
  });

  it('14. admin: always allowed', async () => {
    mockAdmin();
    const { result } = renderHook(() => useCanPerformActionAsync('delete_lead'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ allowed: true, reason: 'admin' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('15. feature action: checks featurePerms', async () => {
    mockMember({ 'workflows.edit': true });
    const { result } = renderHook(() => useCanPerformActionAsync('edit_workflow'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ allowed: true, reason: 'feature:workflows.edit' });
  });

  it('16. send_message: always allowed', async () => {
    mockMember();
    const { result } = renderHook(() => useCanPerformActionAsync('send_message'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ allowed: true, reason: 'open' });
  });

  it('17. delete_lead: calls RPC user_has_org_permission("can_delete_leads")', async () => {
    mockMember();
    mockRpc.mockResolvedValue({ data: true, error: null });

    const { result } = renderHook(() => useCanPerformActionAsync('delete_lead'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('user_has_org_permission', {
      p_permission_key: 'can_delete_leads',
    });
    expect(result.current.data).toEqual({ allowed: true, reason: 'can_delete_leads' });
  });

  it('18. delete_lead: denied when RPC returns false', async () => {
    mockMember();
    mockRpc.mockResolvedValue({ data: false, error: null });

    const { result } = renderHook(() => useCanPerformActionAsync('delete_lead'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.allowed).toBe(false);
    expect(result.current.data?.reason).toContain('can_delete_leads');
  });

  it('19. import_leads: checks matrix permission (team_member_permissions table)', async () => {
    mockMember();
    mockMaybeSingle.mockResolvedValue({ data: { value: 'allowed' }, error: null });

    const { result } = renderHook(() => useCanPerformActionAsync('import_leads'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith('team_member_permissions');
    expect(result.current.data?.allowed).toBe(true);
    expect(result.current.data?.reason).toBe('matrix_allowed');
  });

  it('20. import_leads: denied when matrix value="denied"', async () => {
    mockMember();
    mockMaybeSingle.mockResolvedValue({ data: { value: 'denied' }, error: null });

    const { result } = renderHook(() => useCanPerformActionAsync('import_leads'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.allowed).toBe(false);
    expect(result.current.data?.reason).toContain('leads.create');
  });

  it('21. matrix with no row: defaults to "allowed"', async () => {
    mockMember();
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useCanPerformActionAsync('import_leads'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // data?.value is null -> || "allowed" -> not "denied" -> allowed
    expect(result.current.data?.allowed).toBe(true);
    expect(result.current.data?.reason).toBe('matrix_allowed');
  });

  it('22. matrix without teamMember.id: skips check, denied via fail-closed', async () => {
    // Member with no teamMember.id
    mockUseUserRole.mockReturnValue({ data: { role: 'member' }, isLoading: false });
    mockUseMasterAuth.mockReturnValue({ isMaster: false, isLoading: false });
    mockUseOrganization.mockReturnValue({ organizationId: 'org-1', isReady: true });
    mockUseCurrentTeamMember.mockReturnValue({ data: { role: 'member' }, isLoading: false }); // no .id
    mockUseFeaturePermissions.mockReturnValue({ data: {}, isLoading: false });

    const { result } = renderHook(() => useCanPerformActionAsync('import_leads'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // matrixMapping exists but teamMember.id is undefined -> condition fails -> fail-closed
    expect(result.current.data).toEqual({ allowed: false, reason: 'unmapped_action' });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════
// DIVERGENCE documentation
// ═══════════════════════════════════════════════════════════

describe('CONVERGENCE: sync and async both fail-closed', () => {
  // After fail-closed fix (#186), both sync and async deny unmapped paths.
  // delete_lead is in ACTION_TO_ORG_PERMISSION -> "can_delete_leads"
  // The sync version still never calls RPC, but now denies instead of allowing.

  it('23. delete_lead — both sync and async deny for member', async () => {
    mockMember();

    // Sync: denies via fail-closed
    const { result: syncResult } = renderHook(() => useCanPerformAction('delete_lead'), {
      wrapper: createWrapper(),
    });
    expect(syncResult.current.allowed).toBe(false);
    expect(syncResult.current.reason).toBe('unmapped_action');

    // Async: checks RPC and also denies
    mockRpc.mockResolvedValue({ data: false, error: null });
    const { result: asyncResult } = renderHook(() => useCanPerformActionAsync('delete_lead'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(asyncResult.current.isSuccess).toBe(true));
    expect(asyncResult.current.data?.allowed).toBe(false);

    // CONVERGENCE: both deny
    expect(syncResult.current.allowed).toBe(asyncResult.current.data?.allowed);
  });

  // import_leads is in ACTION_TO_MATRIX -> { resource: "leads", action: "create" }
  // Sync: hits fail-closed. Async: checks matrix and may deny.

  it('24. import_leads — both sync and async deny for member (matrix denied)', async () => {
    mockMember();

    // Sync: denies via fail-closed
    const { result: syncResult } = renderHook(() => useCanPerformAction('import_leads'), {
      wrapper: createWrapper(),
    });
    expect(syncResult.current.allowed).toBe(false);
    expect(syncResult.current.reason).toBe('unmapped_action');

    // Async: checks matrix and denies
    mockMaybeSingle.mockResolvedValue({ data: { value: 'denied' }, error: null });
    const { result: asyncResult } = renderHook(() => useCanPerformActionAsync('import_leads'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(asyncResult.current.isSuccess).toBe(true));
    expect(asyncResult.current.data?.allowed).toBe(false);

    // CONVERGENCE: both deny
    expect(syncResult.current.allowed).toBe(asyncResult.current.data?.allowed);
  });
});

// ═══════════════════════════════════════════════════════════
// useHasPermission (src/hooks/usePermissions.ts)
// ═══════════════════════════════════════════════════════════

describe('useHasPermission', () => {
  it('25. admin returns true without RPC', async () => {
    mockAdmin();
    const { result } = renderHook(() => useHasPermission('can_delete_leads'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(true);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
