import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAvatarMap } from "./useAvatarMap";

const state = vi.hoisted(() => ({
  org: "org-a" as string | null,
  filters: [] as Array<[string, string, unknown]>,
  tables: [] as string[],
  empty: false,
}));
vi.mock("../org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: state.org, isReady: !!state.org }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      state.tables.push(table);
      const org = state.org;
      const chain = {
        select: () => chain,
        eq: (field: string, value: unknown) => { state.filters.push([table, field, value]); return chain; },
        in: (field: string, value: unknown) => { state.filters.push([table, field, value]); return chain; },
        not: () => chain,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({
          error: null,
          data: table === "team_members"
            ? state.empty ? [] : [{ id: "member-" + org, user_id: "user-" + org }]
            : [{ id: "user-" + org, avatar_url: "/" + org + ".png" }],
        })),
      };
      return chain;
    },
  },
}));
beforeEach(() => { state.org = "org-a"; state.filters = []; state.tables = []; state.empty = false; });
afterEach(cleanup);
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
describe("useAvatarMap organization scope", () => {
  it("queries only the selected organization's members and their profiles", async () => {
    const { result } = renderHook(() => useAvatarMap(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.get("member-org-a")).toBe("/org-a.png"));
    expect(state.filters).toContainEqual(["team_members", "organization_id", "org-a"]);
    expect(state.filters).toContainEqual(["profiles", "id", ["user-org-a"]]);
  });
  it("does not reuse previous organization photos while switching", async () => {
    const { result, rerender } = renderHook(() => useAvatarMap(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.has("member-org-a")).toBe(true));
    state.org = "org-b"; rerender();
    expect(result.current.has("member-org-a")).toBe(false);
    await waitFor(() => expect(result.current.get("member-org-b")).toBe("/org-b.png"));
  });
  it("does not query without an organization", () => {
    state.org = null;
    renderHook(() => useAvatarMap(), { wrapper: wrapper() });
    expect(state.tables).toEqual([]);
  });
  it("does not query profiles if there are no members", async () => {
    state.empty = true;
    renderHook(() => useAvatarMap(), { wrapper: wrapper() });
    await waitFor(() => expect(state.tables).toContain("team_members"));
    expect(state.tables).not.toContain("profiles");
  });
});

