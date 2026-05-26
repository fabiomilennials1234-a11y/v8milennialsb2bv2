import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before import
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(), channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }) },
}));
vi.mock("@/modules/identity/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" }, session: {} }),
}));
vi.mock("@/modules/identity/hooks/useMasterAuth", () => ({
  useMasterAuth: () => ({ isMaster: false, isLoading: false }),
}));
vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useRealtimeSubscription: vi.fn(),
}));
vi.mock("@/modules/identity/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-1", isReady: true }),
}));

import {
  isVirtualTeamMember,
  getSelectedOrgId,
  setSelectedOrgId,
} from "@/modules/identity/hooks/useTeamMembers";

describe("isVirtualTeamMember", () => {
  it("returns true for master-virtual- prefix", () => {
    expect(isVirtualTeamMember("master-virtual-abc123")).toBe(true);
  });

  it("returns false for normal UUID", () => {
    expect(isVirtualTeamMember("550e8400-e29b-41d4-a716-446655440000")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isVirtualTeamMember(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isVirtualTeamMember(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isVirtualTeamMember("")).toBe(false);
  });
});

describe("getSelectedOrgId / setSelectedOrgId", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null when nothing stored", () => {
    expect(getSelectedOrgId()).toBeNull();
  });

  it("stores and retrieves org id", () => {
    setSelectedOrgId("org-123");
    expect(getSelectedOrgId()).toBe("org-123");
  });

  it("overwrites previous value", () => {
    setSelectedOrgId("org-1");
    setSelectedOrgId("org-2");
    expect(getSelectedOrgId()).toBe("org-2");
  });
});
