import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), master: false }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: (...args: unknown[]) => backend.from(...args),
  rpc: (...args: unknown[]) => backend.rpc(...args),
} }));
vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
vi.mock("@/modules/identity/master/hooks/useMasterAuth", () => ({ useMasterAuth: () => ({ isMaster: backend.master, isLoading: false }) }));
vi.mock("@/modules/identity/gestor/hooks/useGestor", () => ({ useGestor: () => ({ isGestor: false, isLoading: false }) }));
vi.mock("@/modules/identity/permissions/hooks/useUserRole", () => ({ useFeaturePermissions: () => ({ data: {}, isLoading: false }) }));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
// Only narrow the barrel's module graph. These are the real hooks, sharing the
// same QueryClient; organization and membership are never independently mocked.
vi.mock("@/modules/identity", async () => ({
  ...(await import("@/modules/identity/org-team/hooks/useOrganization")),
  ...(await import("@/modules/identity/org-team/hooks/useCurrentTeamMember")),
  ...(await import("@/modules/identity/auth/hooks/useIdentity")),
}));

import { useOrganization } from "@/modules/identity/org-team/hooks/useOrganization";
import { useOrgSwitcher } from "@/modules/identity/org-team/hooks/useOrgSwitcher";
import { useCommandMetrics } from "@/modules/analytics/hooks/useCommandMetrics";

const organizations = ["org-A", "org-B"].map((id) => ({
  id, name: id, slug: id, org_type: "crm", timezone: "America/Sao_Paulo",
}));
const range = { start: new Date("2026-09-01T03:00:00Z"), end: new Date("2026-10-01T02:59:59.999Z") };
const member = (organizationId: string) => ({
  id: `member-${organizationId}`, user_id: "user-1", organization_id: organizationId,
  role: "member", name: "User", is_active: true,
});
const dashboardReply = (totalLeads: number) => ({ data: { totalLeads }, error: null });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function tableQuery(table: string) {
  const filters = new Map<string, unknown>();
  const one = () => {
    const orgId = filters.get("organization_id");
    if (table === "team_members") return backend.master ? null : member(String(orgId));
    if (table === "organizations") return organizations.find((org) => org.id === filters.get("id")) ?? null;
    throw new Error(`Unexpected table: ${table}`);
  };
  const rows = () => table === "organizations" ? organizations : organizations.map((org) => ({
    ...member(org.id), organizations: org,
  }));
  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => { filters.set(column, value); return chain; },
    order: () => chain,
    single: async () => ({ data: one(), error: null }),
    maybeSingle: async () => ({ data: one(), error: null }),
    then: (resolve: (value: { data: ReturnType<typeof rows>; error: null }) => unknown) =>
      Promise.resolve({ data: rows(), error: null }).then(resolve),
  };
  return chain;
}

beforeEach(() => {
  backend.master = false;
  backend.from.mockReset().mockImplementation(tableQuery);
  backend.rpc.mockReset().mockImplementation(async (name: string, args: { p_org_id: string }) => {
    if (name !== "get_dashboard_metrics") throw new Error(`Unexpected RPC: ${name}`);
    return dashboardReply(args.p_org_id === "org-A" ? 11 : 22);
  });
  localStorage.setItem("selected_org_id", "org-A");
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { localStorage.removeItem("selected_org_id"); vi.restoreAllMocks(); });

describe("command metrics through the real organization switcher and identity cache", () => {
  it.each([false, true])("keeps B's indicators when A's delayed reply arrives (virtual master: %s)", async (master) => {
    backend.master = master;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    function Wrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }
    const observed: { orgId: string | null; totalLeads: number | undefined }[] = [];
    const { result, unmount } = renderHook(() => {
      const organization = useOrganization();
      const switcher = useOrgSwitcher();
      const metrics = useCommandMetrics(range);
      observed.push({ orgId: organization.organizationId, totalLeads: metrics.data?.totalLeads });
      return { organization, switcher, metrics };
    }, { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.organization.timezone).toBe("America/Sao_Paulo");
      expect(result.current.metrics.data?.totalLeads).toBe(11);
      expect(result.current.metrics.isFetching).toBe(false);
    });
    expect(result.current.organization.teamMemberId).toBe(master ? "master-virtual-user-1" : "member-org-A");

    // switchOrg invalidates all active queries, including A's dashboard. Delay
    // that actual refetch until B has become the current organization.
    const lateA = deferred<ReturnType<typeof dashboardReply>>();
    backend.rpc.mockImplementation((name: string, args: { p_org_id: string }) => {
      if (name !== "get_dashboard_metrics") throw new Error(`Unexpected RPC: ${name}`);
      return args.p_org_id === "org-A" ? lateA.promise : Promise.resolve(dashboardReply(22));
    });
    backend.rpc.mockClear();
    let switching: Promise<void> | undefined;
    act(() => { switching = result.current.switcher.switchOrg("org-B"); });
    await waitFor(() => {
      expect(result.current.organization.organizationId).toBe("org-B");
      expect(result.current.metrics.data?.totalLeads).toBe(22);
    });
    expect(localStorage.getItem("selected_org_id")).toBe("org-B");
    expect(backend.rpc).toHaveBeenCalledWith("get_dashboard_metrics", expect.objectContaining({
      p_org_id: "org-A", p_filter_member_id: master ? undefined : "member-org-A",
    }));
    expect(backend.rpc).toHaveBeenCalledWith("get_dashboard_metrics", expect.objectContaining({
      p_org_id: "org-B", p_filter_member_id: master ? undefined : "member-org-B",
    }));
    expect(result.current.organization.teamMemberId).toBe(master ? "master-virtual-user-1" : "member-org-B");

    await act(async () => { lateA.resolve(dashboardReply(99)); await switching; });
    expect(result.current.metrics.data?.totalLeads).toBe(22);
    expect(result.current.switcher.isSwitching).toBe(false);
    expect(observed.filter((sample) => sample.orgId === "org-B").every((sample) =>
      sample.totalLeads === undefined || sample.totalLeads === 22)).toBe(true);
    unmount();
    client.clear();
  });
});
