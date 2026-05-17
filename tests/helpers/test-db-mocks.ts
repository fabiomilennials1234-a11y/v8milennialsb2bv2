/**
 * Shared mutable mock state for createTestDB.
 *
 * Import this module in your test file and pass these refs to createTestDB.
 * The vi.mock() calls at module level should delegate to these objects.
 *
 * Example usage in a test file:
 *
 *   import { mockSupabaseState, mockOrgState, mockUserRoleState, mockMasterAuthState, setupMocks } from "../helpers/test-db-mocks";
 *   setupMocks(); // Registers vi.mock calls
 *   import { createTestDB } from "../helpers/test-db";
 *
 * NOTE: Because vi.mock is hoisted, you MUST call setupMocks() before any
 * imports that use the mocked modules (or copy the vi.mock calls manually).
 * The recommended pattern is to use the inline `vi.mock` calls from the
 * template below and pass the state refs via options.
 */

import { vi } from "vitest";

export const mockSupabaseState = {
  from: vi.fn(),
  channel: vi.fn(),
  removeChannel: vi.fn(),
};

export const mockOrgState: Record<string, unknown> = {
  organizationId: "default-org",
  isReady: true,
  isLoading: false,
  teamMemberId: null,
  role: null,
  orgType: null,
  error: null,
};

export const mockUserRoleState: Record<string, unknown> = {
  data: { user_id: "user-1", role: "admin" },
  isLoading: false,
};

export const mockMasterAuthState: Record<string, unknown> = {
  isMaster: false,
  isOutbounder: false,
  masterUser: null,
  permissions: {},
  hasPermission: () => false,
  isLoading: false,
  error: null,
};

/**
 * Returns all mock state refs bundled for passing to createTestDB options.
 * Usage: createTestDB(tables, { userRole: 'admin', ...getAllMockRefs() })
 */
export function getAllMockRefs() {
  return {
    _mockOrgState: mockOrgState,
    _mockSupabaseState: mockSupabaseState as any,
    _mockUserRoleState: mockUserRoleState,
    _mockMasterAuthState: mockMasterAuthState,
  };
}
