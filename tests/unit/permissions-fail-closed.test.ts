/**
 * TDD: Permission Engine fail-closed for unmapped actions.
 *
 * useCanDo must deny (not allow) actions that have no explicit mapping.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ─── Mock: useIdentity (useCanDo depends on this) ──────

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

vi.mock('@/hooks/useIdentity', () => ({
  useIdentity: () => mockIdentity,
}));

// ─── Import under test ──────────────────────────────────

import { useCanDo } from '@/hooks/useCanDo';

// ─── Test utilities ─────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

// ─── Preset mock helpers ────────────────────────────────

function mockAdmin() {
  mockIdentity.effectiveRole = "admin";
  mockIdentity.isMaster = false;
  mockIdentity.isAdmin = true;
  mockIdentity.features = {};
  mockIdentity.isLoading = false;
  mockIdentity.isReady = true;
}

function mockMaster() {
  mockIdentity.effectiveRole = "admin";
  mockIdentity.isMaster = true;
  mockIdentity.isAdmin = true;
  mockIdentity.features = {};
  mockIdentity.isLoading = false;
  mockIdentity.isReady = true;
}

function mockMember(featurePerms: Record<string, boolean> = {}) {
  mockIdentity.effectiveRole = "member";
  mockIdentity.isMaster = false;
  mockIdentity.isAdmin = false;
  mockIdentity.features = featurePerms;
  mockIdentity.isLoading = false;
  mockIdentity.isReady = true;
}

// ─── Tests ──────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useCanDo — fail-closed', () => {
  it('1. denies unknown/unmapped action for member', () => {
    mockMember();
    const { result } = renderHook(
      () => useCanDo('totally_unknown_action' as any),
      { wrapper: createWrapper() },
    );
    expect(result.current.allowed).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('2. admin still allowed for mapped action (move_pipe_record)', () => {
    mockAdmin();
    const { result } = renderHook(
      () => useCanDo('move_pipe_record'),
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
      () => useCanDo('totally_unknown_action' as any),
      { wrapper: createWrapper() },
    );
    expect(result.current).toEqual({
      allowed: true,
      reason: 'master',
      isLoading: false,
    });
  });

  it('4. mapped feature action (edit_workflow) still works for member with permission', () => {
    mockMember({ 'workflows.edit': true });
    const { result } = renderHook(
      () => useCanDo('edit_workflow'),
      { wrapper: createWrapper() },
    );
    expect(result.current.allowed).toBe(true);
    expect(result.current.reason).toBe('feature:workflows.edit');
  });

  it('5. mapped feature action (manage_copilot) denied for member without permission', () => {
    mockMember({ 'copilot.create': false });
    const { result } = renderHook(
      () => useCanDo('manage_copilot'),
      { wrapper: createWrapper() },
    );
    expect(result.current.allowed).toBe(false);
  });

  it('6. send_message allowed for member with whatsapp.send_messages permission', () => {
    mockMember({ 'whatsapp.send_messages': true });
    const { result } = renderHook(
      () => useCanDo('send_message'),
      { wrapper: createWrapper() },
    );
    expect(result.current).toEqual({
      allowed: true,
      reason: 'feature:whatsapp.send_messages',
      isLoading: false,
    });
  });

  it('7. denies unknown action for member', () => {
    mockMember();
    const { result } = renderHook(
      () => useCanDo('totally_unknown_action' as any),
      { wrapper: createWrapper() },
    );
    expect(result.current.allowed).toBe(false);
  });

  it('8. admin bypass works for mapped action (delete_lead)', () => {
    mockAdmin();
    const { result } = renderHook(
      () => useCanDo('delete_lead'),
      { wrapper: createWrapper() },
    );
    expect(result.current.allowed).toBe(true);
    expect(result.current.reason).toBe('admin');
  });

  it('9. import_leads allowed when feature permission leads.import=true', () => {
    mockMember({ 'leads.import': true });
    const { result } = renderHook(
      () => useCanDo('import_leads'),
      { wrapper: createWrapper() },
    );
    expect(result.current.allowed).toBe(true);
    expect(result.current.reason).toBe('feature:leads.import');
  });

  it('10. delete_lead allowed when feature permission leads.delete=true', () => {
    mockMember({ 'leads.delete': true });
    const { result } = renderHook(
      () => useCanDo('delete_lead'),
      { wrapper: createWrapper() },
    );
    expect(result.current.allowed).toBe(true);
    expect(result.current.reason).toBe('feature:leads.delete');
  });
});
