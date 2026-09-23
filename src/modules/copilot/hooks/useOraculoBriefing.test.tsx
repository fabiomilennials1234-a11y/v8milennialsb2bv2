import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useOraculoBriefing } from "./useOraculoBriefing";

const mocks = vi.hoisted(() => ({
  identity: { isReady: true, userId: "user-a", organizationId: "org-a" },
  features: { isReady: true, hasFeature: vi.fn(() => true) },
  invoke: vi.fn(),
}));
vi.mock("@/modules/identity", () => ({ useIdentity: () => mocks.identity }));
vi.mock("@/contexts/OrgFeaturesContext", () => ({ useOrgFeatures: () => mocks.features }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
vi.mock("./useOraculoFeedback", () => ({ recordOraculoSignal: vi.fn() }));

const clients: QueryClient[] = [];
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } } });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, ...renderHook(() => useOraculoBriefing(), { wrapper }) };
}
beforeEach(() => {
  mocks.identity = { isReady: true, userId: "user-a", organizationId: "org-a" };
  mocks.features.isReady = true;
  mocks.features.hasFeature.mockReset().mockReturnValue(true);
  mocks.invoke.mockReset().mockResolvedValue({ data: { briefing: { id: "briefing-a" } }, error: null });
});
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); });

it("waits for the plan even when the loading feature helper is fail-open", async () => {
  mocks.features.isReady = false;
  const { result, rerender } = mount();
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(result.current.briefing).toBeNull();
  mocks.features.isReady = true;
  rerender();
  await waitFor(() => expect(result.current.briefing?.id).toBe("briefing-a"));
  expect(mocks.features.hasFeature).toHaveBeenCalledWith("oraculo");
});

it("does not invoke a denied feature and starts after entitlement becomes available", async () => {
  mocks.features.hasFeature.mockReturnValue(false);
  const { result, rerender } = mount();
  expect(mocks.invoke).not.toHaveBeenCalled();
  mocks.features.hasFeature.mockReturnValue(true);
  rerender();
  await waitFor(() => expect(result.current.briefing?.id).toBe("briefing-a"));
  // Uses the resolved feature helper, preserving master, trial and add-on semantics.
  mocks.features.hasFeature.mockReturnValue(false);
  rerender();
  expect(result.current.briefing).toBeNull();
});

it("does not invoke before identity is ready", () => {
  mocks.identity.isReady = false;
  mount();
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it.each([401, 403, 404, 429])("does not retry HTTP %s", async status => {
  mocks.invoke.mockResolvedValue({ data: null, error: Object.assign(new Error("HTTP failure"), { context: new Response(null, { status }) }) });
  const { client } = mount();
  await waitFor(() => expect(client.getQueryState(["oraculo-briefing", "org-a", "user-a"])?.status).toBe("error"));
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
});

it("retries a temporary server failure and recovers the briefing", async () => {
  mocks.invoke.mockResolvedValueOnce({ data: null, error: Object.assign(new Error("temporary"), { context: new Response(null, { status: 503 }) }) });
  const { result } = mount();
  await waitFor(() => expect(result.current.briefing?.id).toBe("briefing-a"));
  expect(mocks.invoke).toHaveBeenCalledTimes(2);
});

it("keeps organization caches separate when switching tenants", async () => {
  const { result, rerender } = mount();
  await waitFor(() => expect(result.current.briefing?.id).toBe("briefing-a"));
  mocks.identity.organizationId = "org-b";
  mocks.invoke.mockResolvedValue({ data: { briefing: { id: "briefing-b" } }, error: null });
  rerender();
  expect(result.current.briefing).toBeNull();
  await waitFor(() => expect(result.current.briefing?.id).toBe("briefing-b"));
  expect(mocks.invoke).toHaveBeenLastCalledWith("oraculo-briefing", { body: { acao: "atual", organization_id: "org-b" } });
});
