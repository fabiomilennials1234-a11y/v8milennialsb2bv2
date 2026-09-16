import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { createMockSupabase } from "../helpers/supabase-mock";
const state = vi.hoisted(() => ({ role: "member", virtual: false, mock: null as ReturnType<typeof createMockSupabase> | null }));
vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => ({ data: { id: "member-a", organization_id: "org-a", role: state.role } }),
  isVirtualTeamMember: () => state.virtual,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => state.mock!.sb.from(table) },
}));

import { useWhatsAppInstancesForUser } from "@/modules/communication/hooks/chat/useWhatsAppInstances";

function renderInstances() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useWhatsAppInstancesForUser(), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

describe("instance visibility", () => {
  beforeEach(() => {
    state.role = "member"; state.virtual = false;
    state.mock = createMockSupabase();
    state.mock.mockTable("whatsapp_instances", ["own", "other", "unassigned"].map(id => ({id, instance_name: id, organization_id: "org-a", status: "connected"})));
    state.mock.mockTable("whatsapp_instance_allowed_members", [
      {whatsapp_instance_id: "own", team_member_id: "member-a"},
      {whatsapp_instance_id: "other", team_member_id: "member-b"},
    ]);
  });
  it("only returns the linked number, excluding other users and unassigned numbers", async () => {
    const { result } = renderInstances();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map(i => i.id)).toEqual(["own"]);
  });
  it.each(["admin", "master"])("preserves %s management access", async (role) => {
    state.role = role === "admin" ? "admin" : "member"; state.virtual = role === "master";
    const { result } = renderInstances();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map(i => i.id)).toEqual(["other", "own", "unassigned"]);
  });
  it("returns no numbers when the user has no links", async () => {
    state.mock!.mockTable("whatsapp_instance_allowed_members", []);
    const { result } = renderInstances();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
  it("fails closed when permission lookup fails", async () => {
    state.mock!.mockSelectError("whatsapp_instance_allowed_members", {code: "42501", message: "denied"});
    const { result } = renderInstances();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
