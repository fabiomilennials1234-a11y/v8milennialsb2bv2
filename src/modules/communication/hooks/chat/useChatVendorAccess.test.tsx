import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { useChatVendorAccess } from "./useChatVendorAccess";

const api = vi.hoisted(() => ({ rpc: vi.fn(), userId: "ivan" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: api.rpc } }));
vi.mock("@/modules/identity", () => ({ useAuth: () => ({ user: { id: api.userId } }) }));
beforeEach(() => { api.rpc.mockReset(); api.userId = "ivan"; });
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, ...renderHook(({ org }) => useChatVendorAccess(org), { wrapper, initialProps: { org: "jrtex" } }) };
}
it("uses the server ownership policy and stays closed while loading", async () => {
  api.rpc.mockResolvedValue({ data: false, error: null });
  const { result, client } = setup();
  expect(result.current).toBe(false);
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(result.current).toBe(false);
  expect(api.rpc).toHaveBeenCalledWith("can_see_chat_scope", { p_org_id: "jrtex", p_lead_id: null, p_normalized_phone: null });
});
it("allows the selector only after a successful server grant, scoped to account and organization", async () => {
  api.rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValue({ data: false, error: null });
  const { result, rerender } = setup();
  await waitFor(() => expect(result.current).toBe(true));
  api.userId = "another-member";
  rerender({ org: "jrtex" });
  expect(result.current).toBe(false);
  rerender({ org: "another-org" });
  expect(result.current).toBe(false);
});
it("does not keep a cached grant after a failed permission refresh", async () => {
  api.rpc.mockResolvedValueOnce({ data: true, error: null });
  const { result, client } = setup();
  await waitFor(() => expect(result.current).toBe(true));
  api.rpc.mockResolvedValue({ data: null, error: new Error("unavailable") });
  await client.invalidateQueries({ queryKey: ["chat_restrict_to_owner"] });
  await waitFor(() => expect(result.current).toBe(false));
});
