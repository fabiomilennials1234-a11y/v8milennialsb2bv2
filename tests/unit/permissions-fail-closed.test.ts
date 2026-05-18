/**
 * TDD: Permission Engine fail-closed for unmapped actions.
 *
 * Issue #186 — useCanPerformAction and useCanPerformActionAsync must
 * deny (not allow) actions that have no explicit mapping.
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

// ─── Mock: useTeamMemberMatrixPermissions ───────────────

const mockUseTeamMemberMatrixPermissions = vi.fn();
vi.mock('@/hooks/useTeamMemberMatrixPermissions', () => ({
  useTeamMemberMatrixPermissions: (...args: unknown[]) =>
    mockUseTeamMemberMatrixPermissions(...args),
}));

// ─── Import under test ──────────────────────────────────

import {
  useCanPerformAction,
  useCanPerformActionAsync,
} from '@/lib/permissions';

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
  mockUseTeamMemberMatrixPermissions.mockReturnValue({ data: new Map(), isLoading: false });
}

function mockMember(featurePerms: Record<string, boolean> = {}) {
  mockUseUserRole.mockReturnValue({ data: { role: 'member' }, isLoading: false });
  mockUseMasterAuth.mockReturnValue({ isMaster: false, isLoading: false });
  mockUseOrganization.mockReturnValue({ organizationId: 'org-1', isReady: true });
  mockUseCurrentTeamMember.mockReturnValue({ data: { id: 'tm-1', role: 'member' }, isLoading: false });
  mockUseFeaturePermissions.mockReturnValue({ data: featurePerms, isLoading: false });
  mockUseTeamMemberMatrixPermissions.mockReturnValue({ data: new Map(), isLoading: false });
}

// ─── Tests ──────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════
// useCanPerformAction — fail-closed for unmapped actions
// ═══════════════════════════════════════════════════════════

describe('useCanPerformAction — fail-closed', () => {
  it('1. denies unknown/unmapped action with reason "unmapped_action"', () => {
    mockMember();
    // "totally_unknown_action" does not exist in any mapping dict.
    // We cast to bypass TS since it's intentionally invalid.
    const { result } = renderHook(
      () => useCanPerformAction('totally_unknown_action' as any),
      { wrapper: createWrapper() },
    );
    expect(result.current).toEqual({
      allowed: false,
      reason: 'unmapped_action',
      isLoading: false,
    });
  });

  it('2. admin still allowed for mapped action (move_pipe_record)', () => {
    mockAdmin();
    const { result } = renderHook(
      () => useCanPerformAction('move_pipe_record'),
      { wrapper: createWrapper() },
    );
    expect(result.current).toEqual({
      allowed: true,
      reason: 'admin',
      isLoading: false,
    });
  });

  it('3. master still allowed for any action including unmapped', () => {
    mockMaster();
    const { result } = renderHook(
      () => useCanPerformAction('totally_unknown_action' as any),
      { wrapper: createWrapper() },
    );
    expect(result.current).toEqual({
      allowed: true,
      reason: 'admin',
      isLoading: false,
    });
  });

  it('4. mapped feature action (edit_workflow) still works for member with permission', () => {
    mockMember({ 'workflows.edit': true });
    const { result } = renderHook(
      () => useCanPerformAction('edit_workflow'),
      { wrapper: createWrapper() },
    );
    expect(result.current.allowed).toBe(true);
    expect(result.current.reason).toBe('feature:workflows.edit');
  });

  it('5. mapped feature action (manage_copilot) denied for member without permission', () => {
    mockMember({ 'copilot.create': false });
    const { result } = renderHook(
      () => useCanPerformAction('manage_copilot'),
      { wrapper: createWrapper() },
    );
    expect(result.current.allowed).toBe(false);
  });

  it('6. open action (send_message) still allowed for member', () => {
    mockMember();
    const { result } = renderHook(
      () => useCanPerformAction('send_message'),
      { wrapper: createWrapper() },
    );
    expect(result.current).toEqual({
      allowed: true,
      reason: 'open',
      isLoading: false,
    });
  });
});

// ═══════════════════════════════════════════════════════════
// useCanPerformActionAsync — fail-closed for unmapped actions
// ═══════════════════════════════════════════════════════════

describe('useCanPerformActionAsync — fail-closed', () => {
  it('7. denies unknown action with reason "unmapped_action"', async () => {
    mockMember();
    const { result } = renderHook(
      () => useCanPerformActionAsync('totally_unknown_action' as any),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      allowed: false,
      reason: 'unmapped_action',
    });
  });

  it('8. admin bypass works for mapped action (delete_lead → org permission)', async () => {
    mockAdmin();
    const { result } = renderHook(
      () => useCanPerformActionAsync('delete_lead'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      allowed: true,
      reason: 'admin',
    });
  });

  it('9. mapped matrix action (import_leads) allowed when matrix returns allowed', async () => {
    mockMember();
    mockMaybeSingle.mockResolvedValue({ data: { value: 'allowed' }, error: null });

    const { result } = renderHook(
      () => useCanPerformActionAsync('import_leads'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.allowed).toBe(true);
    expect(result.current.data?.reason).toContain('matrix');
  });

  it('10. mapped org permission action (delete_lead) checks RPC', async () => {
    mockMember();
    mockRpc.mockResolvedValue({ data: true, error: null });

    const { result } = renderHook(
      () => useCanPerformActionAsync('delete_lead'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      allowed: true,
      reason: 'can_delete_leads',
    });
    expect(mockRpc).toHaveBeenCalledWith('user_has_org_permission', {
      p_permission_key: 'can_delete_leads',
    });
  });
});
