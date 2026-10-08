// Runs against classic/src through vitest.classic.config.ts.
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ member: { id: "member-a", organization_id: "org-a", role: "admin" }, master: false }));
const query = vi.hoisted(() => ({ eq: vi.fn(), select: vi.fn(), not: vi.fn() }));
vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => ({ data: state.member }),
  useMasterAuth: () => ({ isMaster: state.master }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => query } }));
import { useDeadSessions } from "@/modules/communication/hooks/useDeadSessions";
const instance = (id: string, owner: string | null, members: string[]) => ({
  id, owner_team_member_id: owner, whatsapp_instance_allowed_members: members.map(team_member_id => ({ team_member_id })),
  instance_name: id, phone_number: null, session_dead_since: "2026-10-05T10:00:00Z", session_dead_reason: "timeout",
});
beforeEach(() => {
  vi.clearAllMocks(); state.member = { id: "member-a", organization_id: "org-a", role: "admin" }; state.master = false;
  query.eq.mockReturnValue(query); query.select.mockReturnValue(query);
  query.not.mockResolvedValue({ data: [instance("mine", "member-a", []), instance("other-owner", "member-b", ["member-a"]), instance("shared", null, ["member-a"]), instance("other-shared", null, ["member-b"]), instance("unassigned", null, [])], error: null });
});
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const hook = renderHook(useDeadSessions, { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  return { ...hook, close: () => { hook.unmount(); client.clear(); } };
}
it("administrator sees owned, assigned shared and orphan sessions only, with organization scope", async () => {
  const { result, close } = setup();
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.map(row => row.id)).toEqual(["mine", "shared", "unassigned"]);
  expect(query.eq).toHaveBeenCalledWith("organization_id", "org-a");
  close();
});
it("regular member cannot see another member's session or orphan sessions", async () => {
  state.member.role = "member";
  const { result, close } = setup();
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.map(row => row.id)).toEqual(["mine", "shared"]);
  close();
});
it("master fallback applies only to unassigned sessions", async () => {
  state.member.role = "member"; state.master = true;
  const { result, close } = setup();
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.map(row => row.id)).toEqual(["mine", "shared", "unassigned"]);
  close();
});
it("changing user within same organization cannot reuse another user's audience cache", async () => {
  const { result, rerender, close } = setup();
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  act(() => { state.member = { ...state.member, id: "member-b", role: "member" }; rerender(); });
  await waitFor(() => expect(result.current.data?.map(row => row.id)).toEqual(["other-owner", "other-shared"]));
  expect(query.not).toHaveBeenCalledTimes(2);
  close();
});
