/**
 * Unit tests for permission hooks.
 *
 * Covers:
 *   - usePermission      (src/lib/permissions.ts) — RPC-based single key check
 *   - useCanDo           (src/hooks/useCanDo.ts) — ACTION_TO_FEATURE resolver
 *   - useHasPermission   (src/hooks/usePermissions.ts) — RPC-based key check
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
vi.mock('@/modules/identity/hooks/useOrganization', () => ({
  useOrganization: (...args: unknown[]) => mockUseOrganization(...args),
}));

// ─── Mock: useUserRole & useFeaturePermissions ──────────

const mockUseUserRole = vi.fn();
const mockUseFeaturePermissions = vi.fn();
vi.mock('@/modules/identity/permissions/hooks/useUserRole', () => ({
  useUserRole: (...args: unknown[]) => mockUseUserRole(...args),
  useFeaturePermissions: (...args: unknown[]) => mockUseFeaturePermissions(...args),
}));

// ─── Mock: useCurrentTeamMember ─────────────────────────

const mockUseCurrentTeamMember = vi.fn();
vi.mock('@/modules/identity/hooks/useTeamMembers', () => ({
  useCurrentTeamMember: (...args: unknown[]) => mockUseCurrentTeamMember(...args),
}));

// ─── Mock: useMasterAuth ────────────────────────────────

const mockUseMasterAuth = vi.fn();
vi.mock('@/modules/identity/master/hooks/useMasterAuth', () => ({
  useMasterAuth: (...args: unknown[]) => mockUseMasterAuth(...args),
}));

// ─── Mock: AuthContext ──────────────────────────────────

vi.mock('@/modules/identity/auth/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

// ─── Mock: useIdentity (for useCanDo) ───────────────────

const mockIdentity = {
  userId: "user-1",
  organizationId: "org-1",
  teamMemberId: "tm-1",
  effectiveRole: "admin" as "admin" | "member" | null,
  isMaster: false,
  isAdmin: true,
  features: {} as Record<string, boolean>,
  isLoading: false,
  isReady: true,
};

vi.mock('@/modules/identity/auth/hooks/useIdentity', () => ({
  useIdentity: () => mockIdentity,
}));

// ─── Imports under test ─────────────────────────────────

import { usePermission } from '@/modules/identity/permissions/lib/permissions';
import { useCanDo } from '@/modules/identity/permissions/hooks/useCanDo';
import { useHasPermission } from '@/modules/identity/permissions/hooks/usePermissions';

// ─── Test utilities ─────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

// ─── Preset mock helpers ────────────────────────────────

function setAdmin() {
  mockUseUserRole.mockReturnValue({ data: { role: 'admin' }, isLoading: false });
  mockUseMasterAuth.mockReturnValue({ isMaster: false, isLoading: false });
  mockUseOrganization.mockReturnValue({ organizationId: 'org-1', isReady: true });
  mockUseCurrentTeamMember.mockReturnValue({ data: { id: 'tm-1', role: 'admin' }, isLoading: false });
  mockUseFeaturePermissions.mockReturnValue({ data: {}, isLoading: false });
  mockIdentity.effectiveRole = "admin";
  mockIdentity.isMaster = false;
  mockIdentity.isAdmin = true;
  mockIdentity.features = {};
  mockIdentity.isLoading = false;
  mockIdentity.isReady = true;
}

function setMaster() {
  mockUseUserRole.mockReturnValue({ data: { role: 'member' }, isLoading: false });
  mockUseMasterAuth.mockReturnValue({ isMaster: true, isLoading: false });
  mockUseOrganization.mockReturnValue({ organizationId: 'org-1', isReady: true });
  mockUseCurrentTeamMember.mockReturnValue({ data: { id: 'tm-1', role: 'member' }, isLoading: false });
  mockUseFeaturePermissions.mockReturnValue({ data: {}, isLoading: false });
  mockIdentity.effectiveRole = "admin";
  mockIdentity.isMaster = true;
  mockIdentity.isAdmin = true;
  mockIdentity.features = {};
  mockIdentity.isLoading = false;
  mockIdentity.isReady = true;
}

function setMember(featurePerms: Record<string, boolean> = {}) {
  mockUseUserRole.mockReturnValue({ data: { role: 'member' }, isLoading: false });
  mockUseMasterAuth.mockReturnValue({ isMaster: false, isLoading: false });
  mockUseOrganization.mockReturnValue({ organizationId: 'org-1', isReady: true });
  mockUseCurrentTeamMember.mockReturnValue({ data: { id: 'tm-1', role: 'member' }, isLoading: false });
  mockUseFeaturePermissions.mockReturnValue({ data: featurePerms, isLoading: false });
  mockIdentity.effectiveRole = "member";
  mockIdentity.isMaster = false;
  mockIdentity.isAdmin = false;
  mockIdentity.features = featurePerms;
  mockIdentity.isLoading = false;
  mockIdentity.isReady = true;
}

function setLoading() {
  mockUseUserRole.mockReturnValue({ data: null, isLoading: true });
  mockUseMasterAuth.mockReturnValue({ isMaster: false, isLoading: true });
  mockUseOrganization.mockReturnValue({ organizationId: null, isReady: false });
  mockUseCurrentTeamMember.mockReturnValue({ data: null, isLoading: true });
  mockUseFeaturePermissions.mockReturnValue({ data: null, isLoading: true });
  mockIdentity.effectiveRole = null;
  mockIdentity.isMaster = false;
  mockIdentity.isAdmin = false;
  mockIdentity.features = {};
  mockIdentity.isLoading = true;
  mockIdentity.isReady = false;
}

function setNoOrg() {
  mockUseUserRole.mockReturnValue({ data: { role: 'member' }, isLoading: false });
  mockUseMasterAuth.mockReturnValue({ isMaster: false, isLoading: false });
  mockUseOrganization.mockReturnValue({ organizationId: null, isReady: true });
  mockUseCurrentTeamMember.mockReturnValue({ data: { id: 'tm-1', role: 'member' }, isLoading: false });
  mockUseFeaturePermissions.mockReturnValue({ data: {}, isLoading: false });
  mockIdentity.organizationId = null as any;
  mockIdentity.effectiveRole = "member";
  mockIdentity.isMaster = false;
  mockIdentity.isAdmin = false;
  mockIdentity.features = {};
  mockIdentity.isLoading = false;
  mockIdentity.isReady = true;
}

// ─── Tests ──────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockIdentity.organizationId = "org-1";
});

// ═══════════════════════════════════════════════════════════
// usePermission (src/lib/permissions.ts) — RPC-based
// ═══════════════════════════════════════════════════════════

describe('usePermission', () => {
  it('admin returns true without RPC call', async () => {
    setAdmin();
    const { result } = renderHook(() => usePermission('can_delete_leads'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(true);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('master returns true without RPC call', async () => {
    setMaster();
    const { result } = renderHook(() => usePermission('can_delete_leads'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(true);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('member calls user_has_org_permission RPC', async () => {
    setMember();
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

  it('returns false when organizationId is null', async () => {
    setNoOrg();
    const { result } = renderHook(() => usePermission('can_delete_leads'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// useCanDo (src/hooks/useCanDo.ts) — canonical action resolver
// ═══════════════════════════════════════════════════════════

describe('useCanDo', () => {
  it('returns isLoading:true while dependencies load', () => {
    setLoading();
    const { result } = renderHook(() => useCanDo('delete_lead'), {
      wrapper: createWrapper(),
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.allowed).toBe(false);
  });

  it('admin: always allowed', () => {
    setAdmin();
    const { result } = renderHook(() => useCanDo('delete_lead'), {
      wrapper: createWrapper(),
    });
    expect(result.current).toEqual({ allowed: true, reason: 'admin', isLoading: false });
  });

  it('master: always allowed', () => {
    setMaster();
    const { result } = renderHook(() => useCanDo('import_leads'), {
      wrapper: createWrapper(),
    });
    expect(result.current).toEqual({ allowed: true, reason: 'master', isLoading: false });
  });

  it('feature action allowed when feature perm is true', () => {
    setMember({ 'workflows.edit': true });
    const { result } = renderHook(() => useCanDo('edit_workflow'), {
      wrapper: createWrapper(),
    });
    expect(result.current.allowed).toBe(true);
    expect(result.current.reason).toBe('feature:workflows.edit');
  });

  it('feature action denied when feature perm is false', () => {
    setMember({ 'workflows.edit': false });
    const { result } = renderHook(() => useCanDo('edit_workflow'), {
      wrapper: createWrapper(),
    });
    expect(result.current.allowed).toBe(false);
    expect(result.current.reason).toContain('workflows.edit');
  });

  it('send_message allowed with whatsapp.send_messages permission', () => {
    setMember({ 'whatsapp.send_messages': true });
    const { result } = renderHook(() => useCanDo('send_message'), {
      wrapper: createWrapper(),
    });
    expect(result.current).toEqual({ allowed: true, reason: 'feature:whatsapp.send_messages', isLoading: false });
  });

  it('export_leads allowed when feature permission true', () => {
    setMember({ 'leads.export': true });
    const { result } = renderHook(() => useCanDo('export_leads'), {
      wrapper: createWrapper(),
    });
    expect(result.current.allowed).toBe(true);
    expect(result.current.reason).toBe('feature:leads.export');
  });

  it('unmapped action denied (fail-closed)', () => {
    setMember();
    const { result } = renderHook(
      () => useCanDo('totally_unknown_action' as never),
      { wrapper: createWrapper() },
    );
    expect(result.current.allowed).toBe(false);
  });

  it('no org: denied (fail-closed)', () => {
    setNoOrg();
    const { result } = renderHook(() => useCanDo('delete_lead'), {
      wrapper: createWrapper(),
    });
    expect(result.current.allowed).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// useHasPermission (src/hooks/usePermissions.ts)
// ═══════════════════════════════════════════════════════════

describe('useHasPermission', () => {
  it('admin returns true without RPC', async () => {
    setAdmin();
    const { result } = renderHook(() => useHasPermission('can_delete_leads'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(true);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
