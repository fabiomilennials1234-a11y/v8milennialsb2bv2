import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({ role: "member", failAt: 0, calls: 0 }));
vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => ({ data: { id: "member-a", organization_id: "org-a", role: state.role } }),
  isVirtualTeamMember: () => false,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => {
    const call = table === "whatsapp_instance_allowed_members" ? ++state.calls : 0;
    const response = table === "whatsapp_instances"
      ? { data: [{ id: "own" }, { id: "other" }], error: null }
      : call === state.failAt
        ? { data: null, error: new Error("permission lookup unavailable") }
        : { data: call === 1
          ? [{ whatsapp_instance_id: "own" }, { whatsapp_instance_id: "other" }]
          : [{ whatsapp_instance_id: "own", team_member_id: "member-a" }], error: null };
    const chain = {
      select: () => chain, eq: () => chain, neq: () => chain,
      order: () => chain, in: () => chain,
      then: (resolve: (value: typeof response) => unknown) => Promise.resolve(response).then(resolve),
    };
    return chain;
  } },
}));

import { useWhatsAppInstancesForUser } from "@/modules/communication/hooks/chat/useWhatsAppInstances";

function renderInstances() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useWhatsAppInstancesForUser(), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

describe("instance visibility", () => {
  beforeEach(() => { state.role = "member"; state.failAt = 0; state.calls = 0; });
  it("only returns the instance linked to the member", async () => {
    const { result } = renderInstances();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "own" }]);
  });
  it("lets organization admins select all instances", async () => {
    state.role = "admin";
    const { result } = renderInstances();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "own" }, { id: "other" }]);
  });
  it.each([1, 2])("fails closed when permission lookup %s fails", async (failAt) => {
    state.failAt = failAt;
    const { result } = renderInstances();
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.isError).toBe(true);
    expect(result.current.data).toBeUndefined();
  });
});
