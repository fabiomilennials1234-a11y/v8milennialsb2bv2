import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// ── Module-level mocks (hoisted by vitest) ──
// These delegate to mutable state that createTestDB configures.
import {
  mockSupabaseState,
  mockOrgState,
  mockUserRoleState,
  mockMasterAuthState,
  getAllMockRefs,
} from "../helpers/test-db-mocks";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: unknown[]) => mockSupabaseState.from(...args),
    channel: (...args: unknown[]) => mockSupabaseState.channel(...args),
    removeChannel: (...args: unknown[]) => mockSupabaseState.removeChannel(...args),
  },
}));

vi.mock("@/modules/identity/hooks/useOrganization", () => ({
  useOrganization: () => mockOrgState,
}));

vi.mock("@/modules/identity/hooks/useUserRole", () => ({
  useUserRole: () => mockUserRoleState,
  useIsAdmin: () => ({ isAdmin: (mockUserRoleState.data as any)?.role === "admin", isLoading: false }),
}));

vi.mock("@/modules/identity/hooks/useMasterAuth", () => ({
  useMasterAuth: () => mockMasterAuthState,
}));

vi.mock("@/modules/identity/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" }, session: null, loading: false }),
}));

vi.mock("@/modules/identity/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({
    data: { id: "tm-1", organization_id: mockOrgState.organizationId, role: mockUserRoleState.data ? (mockUserRoleState.data as any).role : "admin" },
    isLoading: false,
  }),
}));

import { createTestDB } from "../helpers/test-db";

// ── Tests ──
describe("createTestDB", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns object with wrapper, supabase, emitRealtime", () => {
    const result = createTestDB({});
    expect(result).toHaveProperty("wrapper");
    expect(result).toHaveProperty("supabase");
    expect(result).toHaveProperty("emitRealtime");
    expect(typeof result.wrapper).toBe("function");
    expect(typeof result.emitRealtime).toBe("function");
  });

  it("wrapper renders children without error", () => {
    const { wrapper } = createTestDB({});
    const { result } = renderHook(() => "hello", { wrapper });
    expect(result.current).toBe("hello");
  });

  it("useOrganization inside wrapper gets org from tables.organizations[0]", () => {
    createTestDB(
      { organizations: [{ id: "org-abc", name: "Test Corp" }] },
      { ...getAllMockRefs() },
    );

    expect(mockOrgState.organizationId).toBe("org-abc");
  });

  it("supabase query inside wrapper gets data from tables.leads", async () => {
    const leads = [
      { id: "lead-1", name: "Alice", organization_id: "org-1" },
      { id: "lead-2", name: "Bob", organization_id: "org-1" },
    ];
    const { supabase } = createTestDB({ leads }, { ...getAllMockRefs() });

    const result = await supabase.from("leads").select("*");
    expect(result.data).toEqual(leads);
  });

  it("supabase query with filters works", async () => {
    const leads = [
      { id: "lead-1", name: "Alice", organization_id: "org-1" },
      { id: "lead-2", name: "Bob", organization_id: "org-2" },
    ];
    const { supabase } = createTestDB({ leads }, { ...getAllMockRefs() });

    const result = await supabase.from("leads").select("*").eq("organization_id", "org-1");
    expect(result.data).toEqual([leads[0]]);
  });

  it("options.userRole controls what useUserRole returns inside wrapper", () => {
    createTestDB({}, { userRole: "membro", ...getAllMockRefs() });

    expect((mockUserRoleState.data as any)?.role).toBe("membro");
  });

  it("options.isMaster controls useMasterAuth return value", () => {
    createTestDB({}, { isMaster: true, ...getAllMockRefs() });

    expect(mockMasterAuthState.isMaster).toBe(true);
    expect((mockMasterAuthState as any).hasPermission("all")).toBe(true);
  });

  it("emitRealtime triggers channel callbacks", () => {
    const handler = vi.fn();
    const { emitRealtime, supabase } = createTestDB(
      { leads: [{ id: "lead-1", name: "Old" }] },
      { ...getAllMockRefs() },
    );

    // Simulate subscribing to a channel
    const channel = supabase.channel("leads_realtime_org-1");
    channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "leads" }, handler);
    channel.subscribe();

    emitRealtime("leads", "INSERT", { id: "lead-2", name: "New" });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "INSERT",
        new: { id: "lead-2", name: "New" },
        table: "leads",
      }),
    );
  });

  it("emitRealtime with wildcard event listener", () => {
    const handler = vi.fn();
    const { emitRealtime, supabase } = createTestDB(
      { leads: [] },
      { ...getAllMockRefs() },
    );

    const channel = supabase.channel("test");
    channel.on("postgres_changes", { event: "*", schema: "public", table: "leads" }, handler);
    channel.subscribe();

    emitRealtime("leads", "UPDATE", { id: "lead-1", name: "Updated" });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "UPDATE", table: "leads" }),
    );
  });

  it("defaults to admin role and not master", () => {
    createTestDB({}, { ...getAllMockRefs() });

    expect((mockUserRoleState.data as any)?.role).toBe("admin");
    expect(mockMasterAuthState.isMaster).toBe(false);
  });
});
