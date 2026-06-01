/**
 * Unit tests for useIdentity() hook.
 *
 * Verifies:
 *   1. effectiveRole resolution (master→admin, admin→admin, member→member)
 *   2. isAdmin includes master
 *   3. Master without teamMember: teamMemberId=null, isReady=true
 *   4. Loading state: isLoading=true, isReady=false
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createWrapper } from "../helpers/hook-test-utils";

// ─── Mocks ───────────────────────────────────────────────

const mockAuth = { user: { id: "user-1" }, session: {} };
const mockMaster = { isMaster: false, isLoading: false };
const mockTeamMember = {
  data: {
    id: "tm-1",
    organization_id: "org-1",
    role: "admin",
    job_title: "CTO",
    metric_type: "sales",
  },
  isLoading: false,
};
const mockFeaturePerms = {
  data: { "leads.delete": true, "copilot.create": false },
  isLoading: false,
  isError: false,
};

vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

vi.mock("@/modules/identity/hooks/useMasterAuth", () => ({
  useMasterAuth: () => mockMaster,
}));

vi.mock("@/modules/identity/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => mockTeamMember,
}));

vi.mock("@/modules/identity/permissions/hooks/useUserRole", () => ({
  useFeaturePermissions: () => mockFeaturePerms,
}));

// Import after mocks
import { useIdentity } from "@/modules/identity/auth/hooks/useIdentity";

describe("useIdentity", () => {
  beforeEach(() => {
    mockAuth.user = { id: "user-1" };
    mockMaster.isMaster = false;
    mockMaster.isLoading = false;
    mockTeamMember.data = {
      id: "tm-1",
      organization_id: "org-1",
      role: "admin",
      job_title: "CTO",
      metric_type: "sales",
    };
    mockTeamMember.isLoading = false;
    mockFeaturePerms.data = { "leads.delete": true, "copilot.create": false };
    mockFeaturePerms.isLoading = false;
    mockFeaturePerms.isError = false;
  });

  it("resolves admin effectiveRole for admin team member", () => {
    const { result } = renderHook(() => useIdentity(), {
      wrapper: createWrapper(),
    });

    expect(result.current.effectiveRole).toBe("admin");
    expect(result.current.isAdmin).toBe(true);
    expect(result.current.isMaster).toBe(false);
  });

  it("resolves admin effectiveRole for master user", () => {
    mockMaster.isMaster = true;
    mockTeamMember.data = null as any;

    const { result } = renderHook(() => useIdentity(), {
      wrapper: createWrapper(),
    });

    expect(result.current.effectiveRole).toBe("admin");
    expect(result.current.isAdmin).toBe(true);
    expect(result.current.isMaster).toBe(true);
  });

  it("resolves member effectiveRole for regular member", () => {
    mockTeamMember.data = {
      ...mockTeamMember.data,
      role: "member",
    };

    const { result } = renderHook(() => useIdentity(), {
      wrapper: createWrapper(),
    });

    expect(result.current.effectiveRole).toBe("member");
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isMaster).toBe(false);
  });

  it("master without teamMember: teamMemberId=null, isReady=true", () => {
    mockMaster.isMaster = true;
    mockTeamMember.data = null as any;

    const { result } = renderHook(() => useIdentity(), {
      wrapper: createWrapper(),
    });

    expect(result.current.teamMemberId).toBeNull();
    expect(result.current.isReady).toBe(true);
    expect(result.current.userId).toBe("user-1");
  });

  it("isLoading=true when dependencies loading", () => {
    mockMaster.isLoading = true;

    const { result } = renderHook(() => useIdentity(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isReady).toBe(false);
  });

  it("isLoading=true when teamMember loading", () => {
    mockTeamMember.isLoading = true;

    const { result } = renderHook(() => useIdentity(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isReady).toBe(false);
  });

  it("exposes features from useFeaturePermissions", () => {
    const { result } = renderHook(() => useIdentity(), {
      wrapper: createWrapper(),
    });

    expect(result.current.features).toEqual({
      "leads.delete": true,
      "copilot.create": false,
    });
  });

  it("organizationId comes from teamMember", () => {
    const { result } = renderHook(() => useIdentity(), {
      wrapper: createWrapper(),
    });

    expect(result.current.organizationId).toBe("org-1");
  });

  it("master user isAdmin=true even without team member role", () => {
    mockMaster.isMaster = true;
    mockTeamMember.data = {
      ...mockTeamMember.data,
      role: "member",
    };

    const { result } = renderHook(() => useIdentity(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isAdmin).toBe(true);
    expect(result.current.effectiveRole).toBe("admin");
  });
});
